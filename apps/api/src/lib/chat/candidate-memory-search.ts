import { candidateMemories, canonicalMemories } from "@sivraj/db";
import type { MemorySearchConfig } from "@sivraj/config";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import type { MemoryCandidate } from "@sivraj/retrieval";
import type { ApiDb, AppDependencies } from "../../app.js";
import { withTimeout } from "./chat-promise-timeout.js";
import { readCurrentTruthContext } from "./current-truth.js";
import { readCandidateMemoryTokenAccounting } from "./token-accounting.js";
import { errorMessage, readPositiveInteger } from "./helpers.js";
import { optionalString, readRecord } from "../http/route-helpers.js";
import { collectDecryptedCandidates } from "../memory-search/helpers.js";
import { mapSettledWithConcurrency } from "../memory-search/decrypt.js";

const CHAT_CANDIDATE_MEMORY_DECRYPT_TIMEOUT_DEFAULT_MS = 30_000;
const CHAT_CANDIDATE_MEMORY_DECRYPT_LIMIT_DEFAULT = 1;
const CHAT_MEMORY_PLAINTEXT_CACHE_TTL_DEFAULT_MS = 10 * 60 * 1000;

type PrivateMemoryReader = NonNullable<AppDependencies["privateMemoryReader"]>;

const chatCandidateMemoryCache = new Map<string, {
  expiresAt: number;
  value?: MemoryCandidate | null;
  promise?: Promise<MemoryCandidate | null>;
}>();

export async function loadCandidateMemorySearchCandidates(input: {
  db: ApiDb;
  privateMemoryReader?: PrivateMemoryReader;
  memorySearchConfig: MemorySearchConfig;
  twinId: string;
  query: string;
}) {
  if (!input.privateMemoryReader) {
    return emptyCandidateMemoryContext();
  }
  const rows = await loadCandidateMemoryRows(input);
  const candidateResults = await mapSettledWithConcurrency(
    rows,
    input.memorySearchConfig.decryptConcurrency,
    (row) => toCandidateMemorySearchCandidateWithTimeout(row, input.privateMemoryReader!),
  );
  await logRejectedCandidateMemoryReads({ rows, candidateResults });
  const { candidates } = collectDecryptedCandidates(candidateResults);
  const canonicalMemoryIdsByCandidateId = new Map<string, string>();
  const tokenAccountingByCandidateId = new Map<string, ReturnType<typeof readCandidateMemoryTokenAccounting>>();
  const rowsById = new Map(rows.map((row) => [row.id, row]));
  for (const candidate of candidates) {
    const row = rowsById.get(candidate.id);
    if (row?.canonicalMemoryId) {
      canonicalMemoryIdsByCandidateId.set(candidate.id, row.canonicalMemoryId);
    }
    tokenAccountingByCandidateId.set(
      candidate.id,
      readCandidateMemoryTokenAccounting(row?.metadata, candidate.content),
    );
  }
  return {
    candidates,
    canonicalMemoryIdsByCandidateId,
    tokenAccountingByCandidateId,
  };
}

function emptyCandidateMemoryContext() {
  return {
    candidates: [] as MemoryCandidate[],
    canonicalMemoryIdsByCandidateId: new Map<string, string>(),
    tokenAccountingByCandidateId: new Map<string, ReturnType<typeof readCandidateMemoryTokenAccounting>>(),
  };
}

async function loadCandidateMemoryRows(input: {
  db: ApiDb;
  twinId: string;
  memorySearchConfig: MemorySearchConfig;
}) {
  const decryptLimit = readPositiveInteger(
    process.env["CHAT_CANDIDATE_MEMORY_DECRYPT_LIMIT"],
    CHAT_CANDIDATE_MEMORY_DECRYPT_LIMIT_DEFAULT,
  );
  const rowLimit = Math.min(
    Math.max(decryptLimit, 1),
    input.memorySearchConfig.decryptEvidenceLimit,
    input.memorySearchConfig.shortlistLimit,
  );
  const baseFilters = [
    eq(candidateMemories.twinId, input.twinId),
    ne(candidateMemories.status, "superseded"),
    archivedCandidateMemoryFilter(),
  ];
  const fallbackRows = await input.db
    .select()
    .from(candidateMemories)
    .where(and(...baseFilters))
    .orderBy(desc(candidateMemories.createdAt))
    .limit(Math.min(rowLimit, input.memorySearchConfig.fallbackLimit));
  return filterActiveCanonicalCandidateRows(input.db, fallbackRows);
}

async function filterActiveCanonicalCandidateRows(
  db: ApiDb,
  rows: Array<typeof candidateMemories.$inferSelect>,
) {
  const canonicalIds = Array.from(new Set(
    rows.map((row) => row.canonicalMemoryId).filter((id): id is string => Boolean(id)),
  ));
  if (canonicalIds.length === 0) {
    return rows;
  }
  const canonicalRows = await db
    .select({
      id: canonicalMemories.id,
      metadata: canonicalMemories.metadata,
    })
    .from(canonicalMemories)
    .where(inArray(canonicalMemories.id, canonicalIds));
  const activeEvidenceHashByCanonicalId = new Map<string, string>();
  for (const row of canonicalRows) {
    const currentTruth = readRecord(readRecord(row.metadata)?.["currentTruth"]);
    const evidenceHash = optionalString(currentTruth?.["evidenceHash"]);
    if (evidenceHash) {
      activeEvidenceHashByCanonicalId.set(row.id, evidenceHash);
    }
  }
  return rows.filter((row) => {
    if (!row.canonicalMemoryId) {
      return true;
    }
    const activeEvidenceHash = activeEvidenceHashByCanonicalId.get(row.canonicalMemoryId);
    return !activeEvidenceHash || activeEvidenceHash === row.evidenceHash;
  });
}

function archivedCandidateMemoryFilter() {
  return sql`${candidateMemories.statementStorageRef} not like 'pending://%'`;
}

function toCandidateMemorySearchCandidateWithTimeout(
  row: typeof candidateMemories.$inferSelect,
  privateMemoryReader: PrivateMemoryReader,
) {
  const timeoutMs = readPositiveInteger(
    process.env["CHAT_CANDIDATE_MEMORY_DECRYPT_TIMEOUT_MS"],
    CHAT_CANDIDATE_MEMORY_DECRYPT_TIMEOUT_DEFAULT_MS,
  );
  const cacheTtlMs = readPositiveInteger(
    process.env["CHAT_MEMORY_PLAINTEXT_CACHE_TTL_MS"],
    CHAT_MEMORY_PLAINTEXT_CACHE_TTL_DEFAULT_MS,
  );
  const cacheKey = chatCandidateMemoryCacheKey(row);
  const now = Date.now();
  const cached = chatCandidateMemoryCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    if ("value" in cached) {
      return Promise.resolve(cached.value ?? null);
    }
    if (cached.promise) {
      return withTimeout(cached.promise, timeoutMs, `chat_candidate_memory_read_timeout:${row.id}`);
    }
  }
  const readPromise = toCandidateMemorySearchCandidate(row, privateMemoryReader)
    .then((candidate) => {
      chatCandidateMemoryCache.set(cacheKey, {
        value: candidate,
        expiresAt: Date.now() + cacheTtlMs,
      });
      return candidate;
    })
    .catch((error) => {
      chatCandidateMemoryCache.delete(cacheKey);
      throw error;
    });
  chatCandidateMemoryCache.set(cacheKey, {
    promise: readPromise,
    expiresAt: now + cacheTtlMs,
  });
  return withTimeout(readPromise, timeoutMs, `chat_candidate_memory_read_timeout:${row.id}`);
}

async function toCandidateMemorySearchCandidate(
  row: typeof candidateMemories.$inferSelect,
  privateMemoryReader: PrivateMemoryReader,
): Promise<MemoryCandidate | null> {
  if (!privateMemoryReader || !row.statementStorageRef || row.statementStorageRef.startsWith("pending://")) {
    return null;
  }
  const decryptedContent = await privateMemoryReader.readPrivateMemory({
    rawStorageRef: row.statementStorageRef,
    artifactId: row.sourceArtifactId,
    twinId: row.twinId,
    expectedCiphertextSha256: row.statementSha256,
  });
  const statement = readCandidateMemoryBatchStatementContent(decryptedContent, row.metadata);
  if (!statement) {
    return null;
  }
  return {
    id: row.id,
    twinId: row.twinId,
    sourceArtifactId: row.sourceArtifactId,
    content: formatCandidateMemorySearchContent({
      statement,
      metadata: row.metadata,
      memoryType: row.memoryType,
    }),
    summary: formatCandidateMemorySearchSummary({
      statement,
      metadata: row.metadata,
      memoryType: row.memoryType,
    }),
    importanceScore: 0.9,
    confidenceScore: row.confidenceScore,
    occurredAt: null,
    createdAt: row.createdAt,
  };
}

export function readCandidateMemoryBatchStatementContent(content: string, metadata: unknown) {
  const batch = readCandidateMemoryBatch(content);
  const statementIndex = readCandidateStatementIndex(metadata);
  const memory = batch.memories?.find((entry) => entry.statementIndex === statementIndex)
    ?? batch.memories?.[0];
  const statement = typeof memory?.statement === "string" ? memory.statement.trim() : "";
  return statement || null;
}

function readCandidateMemoryBatch(content: string) {
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    const record = readRecord(parsed);
    if (!record || record["kind"] !== "candidate_memory_batch") {
      return {} as { memories?: Array<{ statementIndex?: number; statement?: string }> };
    }
    return parsed as { memories?: Array<{ statementIndex?: number; statement?: string }> };
  } catch {
    return {};
  }
}

function readCandidateStatementIndex(metadata: unknown) {
  const statementIndex = readRecord(metadata)?.["statementIndex"];
  return typeof statementIndex === "number" && Number.isInteger(statementIndex) && statementIndex >= 0
    ? statementIndex
    : 0;
}

export function formatCandidateMemorySearchContent(input: {
  statement: string;
  metadata: unknown;
  memoryType: string;
}) {
  const metadata = readRecord(input.metadata);
  const memoryMetadata = readRecord(metadata?.["memoryMetadata"]);
  const category = optionalString(memoryMetadata?.["category"]);
  const subject = optionalString(metadata?.["subject"]);
  const categoryPrefix = category
    ? `${category} ${input.memoryType} memory`
    : `${input.memoryType} memory`;
  return [
    `${categoryPrefix}: ${input.statement}`,
    subject ? `Subject: ${subject}` : null,
    category ? `Category: ${category}` : null,
  ].filter((line): line is string => Boolean(line)).join("\n");
}

function formatCandidateMemorySearchSummary(input: {
  statement: string;
  metadata: unknown;
  memoryType: string;
}) {
  const metadata = readRecord(input.metadata);
  const memoryMetadata = readRecord(metadata?.["memoryMetadata"]);
  const category = optionalString(memoryMetadata?.["category"]);
  return [
    input.statement,
    input.memoryType,
    category,
  ].filter((value): value is string => Boolean(value)).join(" ");
}

function chatCandidateMemoryCacheKey(row: typeof candidateMemories.$inferSelect) {
  return [
    row.twinId,
    row.id,
    row.statementSha256 ?? "no-sha",
    row.statementStorageRef ?? "no-storage-ref",
  ].join(":");
}

async function logRejectedCandidateMemoryReads(input: {
  rows: Array<typeof candidateMemories.$inferSelect>;
  candidateResults: PromiseSettledResult<MemoryCandidate | null>[];
}) {
  await Promise.all(input.candidateResults.map(async (result, index) => {
    if (result.status !== "rejected") {
      return;
    }
    const row = input.rows[index];
    if (!row) {
      return;
    }
    console.warn("chat candidate memory decrypt skipped", {
      candidateMemoryId: row.id,
      memoryFragmentId: row.memoryFragmentId,
      error: errorMessage(result.reason),
    });
  }));
}
