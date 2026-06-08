import { retrieveRelevantMemories } from "@sivraj/retrieval";
import { candidateMemories, memoryFragments } from "@sivraj/db";
import type { MemorySearchConfig } from "@sivraj/config";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { AppDependencies } from "../../app.js";
import { loadShortlistedMemoryFragmentIds } from "./shortlist.js";

export function orderRowsById<T extends { id: string }>(rows: T[], ids: string[]): T[] {
  const order = new Map(ids.map((id, index) => [id, index]));

  return [...rows].sort((left, right) =>
    (order.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
    (order.get(right.id) ?? Number.MAX_SAFE_INTEGER),
  );
}

export async function loadCanonicalMemoryIdsByFragmentId(input: {
  db: AppDependencies["db"];
  twinId: string;
  memoryFragmentIds: string[];
}): Promise<Map<string, string>> {
  const uniqueIds = Array.from(new Set(input.memoryFragmentIds)).filter(Boolean);

  if (uniqueIds.length === 0) {
    return new Map();
  }

  const rows = await input.db
    .select({
      memoryFragmentId: candidateMemories.memoryFragmentId,
      canonicalMemoryId: candidateMemories.canonicalMemoryId,
    })
    .from(candidateMemories)
    .where(
      and(
        eq(candidateMemories.twinId, input.twinId),
        inArray(candidateMemories.memoryFragmentId, uniqueIds),
      ),
    );

  const map = new Map<string, string>();

  for (const row of rows) {
    if (row.canonicalMemoryId && !map.has(row.memoryFragmentId)) {
      map.set(row.memoryFragmentId, row.canonicalMemoryId);
    }
  }

  return map;
}

export async function loadSearchRows(input: {
  db: AppDependencies["db"];
  twinId: string;
  queryTerms: string[];
  config: MemorySearchConfig;
}): Promise<{
  rows: Array<typeof memoryFragments.$inferSelect>;
  mode: "index_shortlist" | "recent_fallback";
  indexMatchCount: number;
}> {
  const shortlistedIds = await loadShortlistedMemoryFragmentIds(input);

  if (shortlistedIds.length > 0) {
    const unorderedRows = await input.db
      .select()
      .from(memoryFragments)
      .where(
        and(
          eq(memoryFragments.twinId, input.twinId),
          inArray(memoryFragments.id, shortlistedIds),
          activeMemoryFragmentFilter(),
        ),
      )
      .limit(input.config.shortlistLimit);
    const rows = orderRowsById(unorderedRows, shortlistedIds);

    return {
      rows,
      mode: "index_shortlist",
      indexMatchCount: shortlistedIds.length,
    };
  }

  const rows = await input.db
    .select()
    .from(memoryFragments)
    .where(and(
      eq(memoryFragments.twinId, input.twinId),
      activeMemoryFragmentFilter(),
    ))
    .orderBy(desc(memoryFragments.createdAt))
    .limit(input.config.fallbackLimit);

  return {
    rows,
    mode: "recent_fallback",
    indexMatchCount: 0,
  };
}

function activeMemoryFragmentFilter() {
  return sql`(${memoryFragments.metadata}->>'supersededByArtifactId') is null`;
}

export function rankMemorySearchResults(
  candidates: Parameters<typeof retrieveRelevantMemories>[0],
  query: string,
  limit: number | undefined,
) {
  return retrieveRelevantMemories(candidates, {
    query,
    limit: Math.min((limit ?? 5) * 3, 20),
  });
}
