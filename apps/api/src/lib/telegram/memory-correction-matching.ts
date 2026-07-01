import { candidateMemories, canonicalMemories } from "@sivraj/db";
import { and, desc, eq, inArray, ne, or, sql } from "drizzle-orm";
import type { AppDependencies } from "../../app.js";

export const TELEGRAM_MEMORY_CORRECTION_ROW_LIMIT = 50;
export const TELEGRAM_MEMORY_CORRECTION_MAX_MATCHES = 8;

export type CandidateCorrectionRow = Pick<
  typeof candidateMemories.$inferSelect,
  "id" | "canonicalMemoryId" | "memoryType" | "status" | "metadata" | "updatedAt"
>;
export type CanonicalCorrectionRow = Pick<
  typeof canonicalMemories.$inferSelect,
  "id" | "memoryType" | "canonicalKey" | "subject" | "status" | "metadata" | "updatedAt"
>;

export function normalizeTelegramMemoryCorrectionQuery(query: string): string {
  return query.trim().replace(/\s+/gu, " ");
}

export function tokenizeTelegramMemoryCorrectionQuery(query: string): string[] {
  const normalized = normalizeTelegramMemoryCorrectionQuery(query)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_-]+/gu, " ");

  return Array.from(new Set(
    normalized
      .split(/\s+/u)
      .map((term) => term.trim())
      .filter((term) => term.length >= 2),
  )).slice(0, 8);
}

export function buildTelegramMemoryCorrectionSearchText(input: {
  memoryType?: string | null;
  canonicalKey?: string | null;
  subject?: string | null;
  metadata: unknown;
}): string {
  const metadata = readRecord(input.metadata);
  const memoryMetadata = readRecord(metadata["memoryMetadata"]);
  const currentTruth = readRecord(metadata["currentTruth"]);
  const nestedCurrentTruth = readRecord(memoryMetadata["currentTruth"]);
  const engineeringMetadata = readRecord(metadata["engineeringMetadata"]);
  const conversationUnderstanding = readRecord(metadata["conversationUnderstanding"]);

  return [
    input.memoryType,
    input.canonicalKey,
    input.subject,
    metadata["subject"],
    metadata["sourceType"],
    metadata["canonicalKey"],
    metadata["agentContextLine"],
    metadata["lastIntakeMessagePreview"],
    memoryMetadata["category"],
    engineeringMetadata["agentContextLine"],
    conversationUnderstanding["sourceType"],
    currentTruth["kind"],
    currentTruth["slot"],
    currentTruth["qualifier"],
    currentTruth["value"],
    currentTruth["subject"],
    currentTruth["agentContextLine"],
    currentTruth["sourceMessagePreview"],
    currentTruth["engineeringMemoryType"],
    currentTruth["engineeringInstructionScope"],
    nestedCurrentTruth["kind"],
    nestedCurrentTruth["slot"],
    nestedCurrentTruth["qualifier"],
    nestedCurrentTruth["value"],
    nestedCurrentTruth["subject"],
    nestedCurrentTruth["agentContextLine"],
  ]
    .flatMap((value) => typeof value === "string" ? [value] : [])
    .join(" ")
    .toLowerCase();
}

export async function loadTelegramMemoryCorrectionMatches(input: {
  deps: AppDependencies;
  twinId: string;
  terms: string[];
}): Promise<{
  candidates: CandidateCorrectionRow[];
  canonicals: CanonicalCorrectionRow[];
}> {
  if (input.terms.length === 0) {
    return { candidates: [], canonicals: [] };
  }

  const [candidateRows, canonicalRows] = await Promise.all([
    input.deps.db
      .select({
        id: candidateMemories.id,
        canonicalMemoryId: candidateMemories.canonicalMemoryId,
        memoryType: candidateMemories.memoryType,
        status: candidateMemories.status,
        metadata: candidateMemories.metadata,
        updatedAt: candidateMemories.updatedAt,
      })
      .from(candidateMemories)
      .where(and(
        eq(candidateMemories.twinId, input.twinId),
        ne(candidateMemories.status, "superseded"),
        or(...input.terms.map((term) => candidateMemoryCorrectionTermFilter(term))),
      ))
      .orderBy(desc(candidateMemories.updatedAt))
      .limit(TELEGRAM_MEMORY_CORRECTION_ROW_LIMIT),
    input.deps.db
      .select({
        id: canonicalMemories.id,
        memoryType: canonicalMemories.memoryType,
        canonicalKey: canonicalMemories.canonicalKey,
        subject: canonicalMemories.subject,
        status: canonicalMemories.status,
        metadata: canonicalMemories.metadata,
        updatedAt: canonicalMemories.updatedAt,
      })
      .from(canonicalMemories)
      .where(and(
        eq(canonicalMemories.twinId, input.twinId),
        ne(canonicalMemories.status, "superseded"),
        or(...input.terms.map((term) => canonicalMemoryCorrectionTermFilter(term))),
      ))
      .orderBy(desc(canonicalMemories.updatedAt))
      .limit(TELEGRAM_MEMORY_CORRECTION_ROW_LIMIT),
  ]);
  const rankedCandidates = rankCorrectionRows(candidateRows, input.terms).slice(0, TELEGRAM_MEMORY_CORRECTION_MAX_MATCHES + 1);
  const candidateCanonicalIds = uniqueStrings(
    rankedCandidates
      .map((candidate) => candidate.canonicalMemoryId)
      .filter((id): id is string => Boolean(id)),
  );
  const candidateCanonicals = await loadCanonicalMemoriesById({
    deps: input.deps,
    twinId: input.twinId,
    ids: candidateCanonicalIds,
  });
  const canonicals = uniqueRowsById([
    ...rankCorrectionRows(canonicalRows, input.terms),
    ...candidateCanonicals,
  ]).slice(0, TELEGRAM_MEMORY_CORRECTION_MAX_MATCHES + 1);
  const canonicalIds = canonicals.map((canonical) => canonical.id);
  const canonicalCandidates = await loadCandidateMemoriesByCanonicalId({
    deps: input.deps,
    twinId: input.twinId,
    canonicalIds,
  });

  return {
    candidates: uniqueRowsById([...rankedCandidates, ...canonicalCandidates])
      .slice(0, TELEGRAM_MEMORY_CORRECTION_MAX_MATCHES + 1),
    canonicals,
  };
}

async function loadCanonicalMemoriesById(input: {
  deps: AppDependencies;
  twinId: string;
  ids: string[];
}): Promise<CanonicalCorrectionRow[]> {
  if (input.ids.length === 0) {
    return [];
  }

  return input.deps.db
    .select({
      id: canonicalMemories.id,
      memoryType: canonicalMemories.memoryType,
      canonicalKey: canonicalMemories.canonicalKey,
      subject: canonicalMemories.subject,
      status: canonicalMemories.status,
      metadata: canonicalMemories.metadata,
      updatedAt: canonicalMemories.updatedAt,
    })
    .from(canonicalMemories)
    .where(and(
      eq(canonicalMemories.twinId, input.twinId),
      ne(canonicalMemories.status, "superseded"),
      inArray(canonicalMemories.id, input.ids),
    ));
}

async function loadCandidateMemoriesByCanonicalId(input: {
  deps: AppDependencies;
  twinId: string;
  canonicalIds: string[];
}): Promise<CandidateCorrectionRow[]> {
  if (input.canonicalIds.length === 0) {
    return [];
  }

  return input.deps.db
    .select({
      id: candidateMemories.id,
      canonicalMemoryId: candidateMemories.canonicalMemoryId,
      memoryType: candidateMemories.memoryType,
      status: candidateMemories.status,
      metadata: candidateMemories.metadata,
      updatedAt: candidateMemories.updatedAt,
    })
    .from(candidateMemories)
    .where(and(
      eq(candidateMemories.twinId, input.twinId),
      ne(candidateMemories.status, "superseded"),
      inArray(candidateMemories.canonicalMemoryId, input.canonicalIds),
    ))
    .orderBy(desc(candidateMemories.updatedAt))
    .limit(TELEGRAM_MEMORY_CORRECTION_ROW_LIMIT);
}

function rankCorrectionRows<T extends { metadata: unknown; memoryType?: string | null; updatedAt: Date }>(
  rows: T[],
  terms: string[],
): T[] {
  return rows
    .map((row) => ({
      row,
      score: terms.filter((term) => buildTelegramMemoryCorrectionSearchText(row).includes(term)).length,
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) =>
      right.score - left.score ||
      right.row.updatedAt.getTime() - left.row.updatedAt.getTime()
    )
    .map((entry) => entry.row);
}

function candidateMemoryCorrectionTermFilter(term: string) {
  const pattern = `%${escapeLike(term)}%`;

  return sql`
    lower(coalesce(${candidateMemories.memoryType}::text, '')) like ${pattern} escape '\\'
    or lower(coalesce(${candidateMemories.metadata}->>'subject', '')) like ${pattern} escape '\\'
    or lower(coalesce(${candidateMemories.metadata}->>'sourceType', '')) like ${pattern} escape '\\'
    or lower(coalesce(${candidateMemories.metadata}->>'canonicalKey', '')) like ${pattern} escape '\\'
    or lower(coalesce(${candidateMemories.metadata}->>'agentContextLine', '')) like ${pattern} escape '\\'
    or lower(coalesce(${candidateMemories.metadata}->>'lastIntakeMessagePreview', '')) like ${pattern} escape '\\'
    or lower(coalesce(${candidateMemories.metadata}->'currentTruth'->>'slot', '')) like ${pattern} escape '\\'
    or lower(coalesce(${candidateMemories.metadata}->'currentTruth'->>'value', '')) like ${pattern} escape '\\'
    or lower(coalesce(${candidateMemories.metadata}->'currentTruth'->>'qualifier', '')) like ${pattern} escape '\\'
    or lower(coalesce(${candidateMemories.metadata}->'currentTruth'->>'agentContextLine', '')) like ${pattern} escape '\\'
    or lower(coalesce(${candidateMemories.metadata}->'memoryMetadata'->>'category', '')) like ${pattern} escape '\\'
    or lower(coalesce(${candidateMemories.metadata}->'memoryMetadata'->'currentTruth'->>'slot', '')) like ${pattern} escape '\\'
    or lower(coalesce(${candidateMemories.metadata}->'memoryMetadata'->'currentTruth'->>'value', '')) like ${pattern} escape '\\'
    or lower(coalesce(${candidateMemories.metadata}->'conversationUnderstanding'->>'sourceType', '')) like ${pattern} escape '\\'
  `;
}

function canonicalMemoryCorrectionTermFilter(term: string) {
  const pattern = `%${escapeLike(term)}%`;

  return sql`
    lower(coalesce(${canonicalMemories.memoryType}::text, '')) like ${pattern} escape '\\'
    or lower(coalesce(${canonicalMemories.canonicalKey}, '')) like ${pattern} escape '\\'
    or lower(coalesce(${canonicalMemories.subject}, '')) like ${pattern} escape '\\'
    or lower(coalesce(${canonicalMemories.metadata}->>'sourceType', '')) like ${pattern} escape '\\'
    or lower(coalesce(${canonicalMemories.metadata}->>'agentContextLine', '')) like ${pattern} escape '\\'
    or lower(coalesce(${canonicalMemories.metadata}->>'lastIntakeMessagePreview', '')) like ${pattern} escape '\\'
    or lower(coalesce(${canonicalMemories.metadata}->'currentTruth'->>'kind', '')) like ${pattern} escape '\\'
    or lower(coalesce(${canonicalMemories.metadata}->'currentTruth'->>'slot', '')) like ${pattern} escape '\\'
    or lower(coalesce(${canonicalMemories.metadata}->'currentTruth'->>'value', '')) like ${pattern} escape '\\'
    or lower(coalesce(${canonicalMemories.metadata}->'currentTruth'->>'qualifier', '')) like ${pattern} escape '\\'
    or lower(coalesce(${canonicalMemories.metadata}->'currentTruth'->>'subject', '')) like ${pattern} escape '\\'
    or lower(coalesce(${canonicalMemories.metadata}->'currentTruth'->>'agentContextLine', '')) like ${pattern} escape '\\'
    or lower(coalesce(${canonicalMemories.metadata}->'currentTruth'->>'engineeringMemoryType', '')) like ${pattern} escape '\\'
    or lower(coalesce(${canonicalMemories.metadata}->'currentTruth'->>'engineeringInstructionScope', '')) like ${pattern} escape '\\'
  `;
}

export function uniqueRowsById<T extends { id: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  const uniqueRows: T[] = [];

  for (const row of rows) {
    if (seen.has(row.id)) {
      continue;
    }

    seen.add(row.id);
    uniqueRows.push(row);
  }

  return uniqueRows;
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values));
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/gu, (char) => `\\${char}`);
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
