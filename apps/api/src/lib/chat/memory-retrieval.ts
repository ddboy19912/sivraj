/**
 * Hot and archive memory retrieval for chat context.
 *
 * Prefers canonical current-truth hits, then semantic search over decrypted fragments,
 * with bounded concurrency and fragment decrypt caching.
 */
import type { MemorySearchConfig } from "@sivraj/config";
import type { MemoryCandidate } from "@sivraj/retrieval";
import { memoryFragments } from "@sivraj/db";
import { eq } from "drizzle-orm";
import type { ApiDb, AppDependencies } from "../../app.js";
import type { ChatMemoryContext, ChatRuntimeConfig } from "../../types/chat.types.js";
import type { ConversationContextResolution, MemoryRequestScope } from "./turn-types.js";
import { withTimeout } from "./chat-promise-timeout.js";
import { loadCandidateMemorySearchCandidates } from "./candidate-memory-search.js";
import {
  loadCanonicalCurrentTruthSearchCandidates,
  selectCurrentTruthMemoryResults,
  shouldUseHotCurrentTruthFallback,
} from "./current-truth.js";
import {
  memoryMatchesScope,
  memorySearchTerms,
  readMemoryRequestFromContext,
} from "./memory-request.js";
import { rankChatMemoryResults } from "./memory-ranking.js";
import { readMemoryTokenAccounting } from "./token-accounting.js";
import { errorMessage, readPositiveInteger } from "./helpers.js";
import { collectDecryptedCandidates, dedupeRetrievalResults, selectRowsForDecrypt } from "../memory-search/helpers.js";
import { loadCanonicalMemoryIdsByFragmentId, loadSearchRows } from "../memory-search/load.js";
import { mapSettledWithConcurrency, toMemorySearchCandidate } from "../memory-search/decrypt.js";

const CHAT_MEMORY_READABLE_STATUSES = ["verified_available", "renewed"] as const;
const CHAT_MEMORY_DECRYPT_TIMEOUT_DEFAULT_MS = 30_000;
const CHAT_MEMORY_PLAINTEXT_CACHE_TTL_DEFAULT_MS = 10 * 60 * 1000;

type PrivateMemoryReader = NonNullable<AppDependencies["privateMemoryReader"]>;
type RankedMemoryResult = ReturnType<typeof selectCurrentTruthMemoryResults>[number];

const chatMemoryCandidateCache = new Map<string, {
  expiresAt: number;
  value?: Awaited<ReturnType<typeof toMemorySearchCandidate>> | null;
  promise?: ReturnType<typeof toMemorySearchCandidate>;
}>();

export function emptyMemoryContext(): ChatMemoryContext {
  return {
    results: [],
    tokenAccountingByMemoryId: new Map(),
  };
}

/** Load ranked memory results and token accounting for prompt assembly. */
export async function loadMemoryContext(input: {
  db: ApiDb;
  privateMemoryReader?: PrivateMemoryReader;
  memorySearchConfig: MemorySearchConfig;
  twinId: string;
  query: string;
  contextResolution: ConversationContextResolution | Record<string, unknown>;
  runtimeConfig: ChatRuntimeConfig;
  llmFetch?: typeof fetch;
}): Promise<ChatMemoryContext> {
  const canonicalCurrentTruthContext = await loadCanonicalCurrentTruthSearchCandidates({
    db: input.db,
    twinId: input.twinId,
  });
  const hotCurrentTruthResults = await rankChatMemoryResults({
    candidates: canonicalCurrentTruthContext.candidates,
    query: input.query,
    limit: 5,
    runtimeConfig: input.runtimeConfig,
    llmFetch: input.llmFetch,
  });
  const currentTruthFallbackResults = shouldUseHotCurrentTruthFallback(
    input.query,
    input.contextResolution as ConversationContextResolution,
  )
    ? selectCurrentTruthMemoryResults(canonicalCurrentTruthContext.candidates)
    : [];
  const memoryRequest = readMemoryRequestFromContext(input.contextResolution, input.query);
  const memoryScope = memoryRequest.kind === "none" ? "all" : memoryRequest.scope;
  if (!input.privateMemoryReader) {
    return {
      results: dedupeRetrievalResults(
        filterResultsByMemoryRequestScope(
          [...hotCurrentTruthResults, ...currentTruthFallbackResults],
          memoryScope,
        ),
        5,
        canonicalCurrentTruthContext.canonicalMemoryIdsByCandidateId,
      ).results,
      tokenAccountingByMemoryId: canonicalCurrentTruthContext.tokenAccountingByCandidateId,
    };
  }
  const queryTerms = memoryQueryTerms(input.query, input.contextResolution);
  const { rows } = await loadSearchRows({
    db: input.db,
    twinId: input.twinId,
    queryTerms,
    config: input.memorySearchConfig,
  });
  const candidateMemoryContext = await loadCandidateMemorySearchCandidates({
    db: input.db,
    privateMemoryReader: input.privateMemoryReader,
    memorySearchConfig: input.memorySearchConfig,
    twinId: input.twinId,
    query: input.query,
    queryTerms,
  });
  const readableRows = rows.filter(isChatMemoryReadableRow);
  const canonicalMemoryIdsByFragmentId = await loadCanonicalMemoryIdsByFragmentId({
    db: input.db,
    twinId: input.twinId,
    memoryFragmentIds: readableRows.map((row) => row.id),
  });
  const rowsSelectedForDecrypt = selectRowsForDecrypt({
    rows: readableRows,
    canonicalMemoryIdsByFragmentId,
    limit: 5,
    decryptEvidenceLimit: input.memorySearchConfig.decryptEvidenceLimit,
  });
  const candidateResults = await mapSettledWithConcurrency(
    rowsSelectedForDecrypt,
    input.memorySearchConfig.decryptConcurrency,
    (row) => toMemorySearchCandidateWithTimeout(row, input.privateMemoryReader!),
  );
  await markRejectedMemoryReads({
    db: input.db,
    rows: rowsSelectedForDecrypt,
    candidateResults,
  });
  const { candidates } = collectDecryptedCandidates(candidateResults);
  const combinedCandidates = [
    ...canonicalCurrentTruthContext.candidates,
    ...candidateMemoryContext.candidates,
    ...candidates,
  ].filter((candidate) => memoryMatchesScope(candidate.content, memoryScope));
  const candidatesById = new Map(combinedCandidates.map((candidate) => [candidate.id, candidate]));
  const rowsById = new Map(rowsSelectedForDecrypt.map((row) => [row.id, row]));
  const canonicalMemoryIdsByMemoryId = new Map([
    ...canonicalCurrentTruthContext.canonicalMemoryIdsByCandidateId,
    ...candidateMemoryContext.canonicalMemoryIdsByCandidateId,
    ...canonicalMemoryIdsByFragmentId,
  ]);
  if (memoryRequest.kind === "inventory" || memoryRequest.kind === "followup") {
    const { results } = dedupeRetrievalResults(
      toInventoryMemoryResults(
        combinedCandidates,
        filterResultsByMemoryRequestScope(currentTruthFallbackResults, memoryScope),
      ),
      5,
      canonicalMemoryIdsByMemoryId,
    );
    return {
      results,
      tokenAccountingByMemoryId: buildTokenAccountingByMemoryId({
        results,
        rowsById,
        candidatesById,
        currentTruthTokenAccounting: canonicalCurrentTruthContext.tokenAccountingByCandidateId,
        candidateTokenAccounting: candidateMemoryContext.tokenAccountingByCandidateId,
      }),
    };
  }

  const rawResults = await rankChatMemoryResults({
    candidates: combinedCandidates,
    query: input.query,
    limit: 5,
    runtimeConfig: input.runtimeConfig,
    llmFetch: input.llmFetch,
  });
  const { results } = dedupeRetrievalResults(
    [
      ...filterResultsByMemoryRequestScope(hotCurrentTruthResults, memoryScope),
      ...rawResults,
      ...filterResultsByMemoryRequestScope(currentTruthFallbackResults, memoryScope),
    ],
    5,
    canonicalMemoryIdsByMemoryId,
  );
  return {
    results,
    tokenAccountingByMemoryId: buildTokenAccountingByMemoryId({
      results,
      rowsById,
      candidatesById,
      currentTruthTokenAccounting: canonicalCurrentTruthContext.tokenAccountingByCandidateId,
      candidateTokenAccounting: candidateMemoryContext.tokenAccountingByCandidateId,
    }),
  };
}

function isChatMemoryReadableRow(row: { storageStatus: string; storageLastReadErrorCode?: string | null }) {
  return CHAT_MEMORY_READABLE_STATUSES.includes(row.storageStatus as typeof CHAT_MEMORY_READABLE_STATUSES[number])
    || (row.storageStatus === "read_failed" && row.storageLastReadErrorCode === "read_timeout");
}

export function memoryQueryTerms(
  query: string,
  contextResolution?: ConversationContextResolution | Record<string, unknown>,
): string[] {
  return memorySearchTerms({
    query,
    memoryRequest: readMemoryRequestFromContext(contextResolution, query),
  });
}

function filterResultsByMemoryRequestScope(
  results: RankedMemoryResult[],
  scope: MemoryRequestScope | undefined,
): RankedMemoryResult[] {
  if (!scope) {
    return results;
  }

  return results.filter((result) => memoryMatchesScope(result.memory.content, scope));
}

function toInventoryMemoryResults(
  candidates: MemoryCandidate[],
  currentTruthResults: RankedMemoryResult[],
): RankedMemoryResult[] {
  const candidateIds = new Set(candidates.map((candidate) => candidate.id));
  return [
    ...candidates.map((memory, index) => ({
      memory,
      score: Number((24 - index).toFixed(4)),
      matchedTerms: ["inventory"],
    })),
    ...currentTruthResults.filter((result) => !candidateIds.has(result.memory.id)),
  ];
}

function buildTokenAccountingByMemoryId(input: {
  results: RankedMemoryResult[];
  rowsById: Map<string, Parameters<typeof toMemorySearchCandidate>[0]>;
  candidatesById: Map<string, MemoryCandidate>;
  currentTruthTokenAccounting: Map<string, ReturnType<typeof readMemoryTokenAccounting>>;
  candidateTokenAccounting: Map<string, ReturnType<typeof readMemoryTokenAccounting>>;
}) {
  const tokenAccountingByMemoryId = new Map<string, ReturnType<typeof readMemoryTokenAccounting>>();
  for (const [candidateId, accounting] of input.currentTruthTokenAccounting) {
    tokenAccountingByMemoryId.set(candidateId, accounting);
  }
  for (const [candidateId, accounting] of input.candidateTokenAccounting) {
    tokenAccountingByMemoryId.set(candidateId, accounting);
  }
  for (const result of input.results) {
    const row = input.rowsById.get(result.memory.id);
    const candidate = input.candidatesById.get(result.memory.id);
    if (!tokenAccountingByMemoryId.has(result.memory.id)) {
      tokenAccountingByMemoryId.set(
        result.memory.id,
        readMemoryTokenAccounting(row?.metadata, candidate?.content ?? result.memory.content),
      );
    }
  }
  return tokenAccountingByMemoryId;
}

function toMemorySearchCandidateWithTimeout(
  row: Parameters<typeof toMemorySearchCandidate>[0],
  privateMemoryReader: PrivateMemoryReader,
) {
  const timeoutMs = readPositiveInteger(
    process.env["CHAT_MEMORY_DECRYPT_TIMEOUT_MS"],
    CHAT_MEMORY_DECRYPT_TIMEOUT_DEFAULT_MS,
  );
  const cacheTtlMs = readPositiveInteger(
    process.env["CHAT_MEMORY_PLAINTEXT_CACHE_TTL_MS"],
    CHAT_MEMORY_PLAINTEXT_CACHE_TTL_DEFAULT_MS,
  );
  const cacheKey = chatMemoryCandidateCacheKey(row);
  const now = Date.now();
  const cached = chatMemoryCandidateCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    if ("value" in cached) {
      return Promise.resolve(cached.value ?? null);
    }
    if (cached.promise) {
      return withTimeout(cached.promise, timeoutMs, `chat_memory_read_timeout:${row.id}`);
    }
  }
  const readPromise = toMemorySearchCandidate(row, privateMemoryReader)
    .then((candidate) => {
      chatMemoryCandidateCache.set(cacheKey, {
        value: candidate,
        expiresAt: Date.now() + cacheTtlMs,
      });
      return candidate;
    })
    .catch((error) => {
      chatMemoryCandidateCache.delete(cacheKey);
      throw error;
    });
  chatMemoryCandidateCache.set(cacheKey, {
    promise: readPromise,
    expiresAt: now + cacheTtlMs,
  });
  return withTimeout(readPromise, timeoutMs, `chat_memory_read_timeout:${row.id}`);
}

function chatMemoryCandidateCacheKey(row: { twinId: string; id: string; contentSha256?: string | null; contentStorageRef?: string | null }) {
  return [
    row.twinId,
    row.id,
    row.contentSha256 ?? "no-sha",
    row.contentStorageRef ?? "no-storage-ref",
  ].join(":");
}

async function markRejectedMemoryReads(input: {
  db: ApiDb;
  rows: Array<{ id: string }>;
  candidateResults: PromiseSettledResult<Awaited<ReturnType<typeof toMemorySearchCandidate>> | null>[];
}) {
  await Promise.all(input.candidateResults.map(async (result, index) => {
    if (result.status !== "rejected") {
      return;
    }
    const row = input.rows[index];
    if (!row) {
      return;
    }
    if (!isChatMemoryReadTimeout(result.reason)) {
      await markMemoryFragmentReadFailed(input.db, row.id, result.reason);
    }
    console.warn("chat memory context fragment decrypt skipped", {
      memoryFragmentId: row.id,
      error: errorMessage(result.reason),
    });
  }));
}

function isChatMemoryReadTimeout(error: unknown) {
  return errorMessage(error).includes("chat_memory_read_timeout");
}

async function markMemoryFragmentReadFailed(db: ApiDb, memoryFragmentId: string, error: unknown) {
  await db
    .update(memoryFragments)
    .set({
      storageStatus: "read_failed",
      storageLastReadAt: new Date(),
      storageLastReadErrorCode: classifyMemoryStorageReadError(error),
      storageLastReadErrorMessage: errorMessage(error).slice(0, 1000),
      updatedAt: new Date(),
    })
    .where(eq(memoryFragments.id, memoryFragmentId));
}

function classifyMemoryStorageReadError(error: unknown) {
  const message = errorMessage(error).toLowerCase();
  if (message.includes("blob_not_found") || message.includes("404") || message.includes("does not exist")) {
    return "blob_not_found";
  }
  if (message.includes("sliver") || message.includes("decode blob")) {
    return "walrus_decode_failed";
  }
  if (message.includes("sha-256 mismatch")) {
    return "sha_mismatch";
  }
  if (message.includes("chat_memory_read_timeout") || message.includes("chat_candidate_memory_read_timeout")) {
    return "read_timeout";
  }
  if (message.includes("seal") || message.includes("decrypt")) {
    return "seal_decrypt_failed";
  }
  return "read_failed";
}
