import {
  retrieveRelevantMemories,
  tokenize,
  type MemoryCandidate,
} from "@sivraj/retrieval";
import { AGENT_MEMORY_SEARCH_SCOPE } from "@sivraj/auth";
import {
  auditEvents,
  candidateMemories,
  graphEdges,
  graphNodes,
  memoryFragments,
} from "@sivraj/db";
import { loadMemorySearchConfig, type MemorySearchConfig } from "@sivraj/config";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import type { AppDependencies } from "../app.js";
import { hasActiveAgentGrantForScopes } from "../lib/agent-grants.js";
import { requireAnyScope, requireAuth, type AuthEnv } from "../middleware/auth.js";

export function createMemoryRoutes({
  db,
  privateMemoryReader,
  memorySearchConfig = loadMemorySearchConfig(process.env),
}: AppDependencies) {
  const memoryRoutes = new Hono<AuthEnv>();

  memoryRoutes.post("/search", requireAuth, async (c) => {
    const scopeError = requireAnyScope(c, ["memory:read", AGENT_MEMORY_SEARCH_SCOPE]);

    if (scopeError) {
      return scopeError;
    }

    const auth = c.get("auth");
    const twinId = c.req.param("twinId");

    if (!twinId) {
      return c.json({ error: "missing_twin_id" }, 400);
    }

    if (auth.type !== "service" && auth.twinId !== twinId) {
      return c.json({ error: "twin_scope_mismatch" }, 403);
    }

    if (!await hasActiveAgentGrantForScopes({
      db,
      auth,
      twinId,
      acceptedScopes: [AGENT_MEMORY_SEARCH_SCOPE],
    })) {
      return c.json({ error: "agent_grant_inactive" }, 403);
    }

    const body = await c.req.json().catch(() => null);

    if (!body || typeof body !== "object") {
      return c.json({ error: "invalid_json_body" }, 400);
    }

    const query = requiredString(body["query"]);
    const limit = optionalLimit(body["limit"]);

    if (!query) {
      return c.json({ error: "missing_query" }, 400);
    }

    const startedAt = Date.now();
    const timing: Record<string, number> = {};
    const queryTerms = tokenize(query);
    timing.tokenizeMs = Date.now() - startedAt;
    const shortlistStartedAt = Date.now();
    const { rows, mode, indexMatchCount } = await loadSearchRows({
      db,
      twinId,
      queryTerms,
      config: memorySearchConfig,
    });
    timing.shortlistMs = Date.now() - shortlistStartedAt;
    const encryptedRows = rows.filter((row) => row.contentStorageRef);

    if (encryptedRows.length > 0 && !privateMemoryReader) {
      return c.json({ error: "private_memory_reader_not_configured" }, 503);
    }

    const canonicalLookupStartedAt = Date.now();
    const canonicalMemoryIdsByFragmentId = await loadCanonicalMemoryIdsByFragmentId({
      db,
      twinId,
      memoryFragmentIds: rows.map((row) => row.id),
    });
    timing.canonicalLookupMs = Date.now() - canonicalLookupStartedAt;
    const rowsSelectedForDecrypt = selectRowsForDecrypt({
      rows,
      canonicalMemoryIdsByFragmentId,
      limit,
      config: memorySearchConfig,
    });
    const decryptSkippedCount = Math.max(rows.length - rowsSelectedForDecrypt.length, 0);

    console.info("memory search shortlist completed", {
      twinId,
      mode,
      indexMatchCount,
      rowCount: rows.length,
      encryptedRowCount: encryptedRows.length,
      selectedForDecryptCount: rowsSelectedForDecrypt.length,
      decryptSkippedCount,
      queryTerms,
      timing,
    });

    const decryptStartedAt = Date.now();
    const candidateResults = await mapSettledWithConcurrency(
      rowsSelectedForDecrypt,
      memorySearchConfig.decryptConcurrency,
      (row) => toCandidate(row, privateMemoryReader),
    );
    timing.decryptMs = Date.now() - decryptStartedAt;
    const decryptFailureCount = candidateResults.filter(
      (result) => result.status === "rejected",
    ).length;
    const candidates = candidateResults
      .flatMap((result) => result.status === "fulfilled" ? [result.value] : [])
      .filter((candidate): candidate is MemoryCandidate => candidate !== null);

    if (decryptFailureCount > 0) {
      console.warn("private memory fragment decrypt failures during search", {
        twinId,
        decryptFailureCount,
        candidateCount: candidates.length,
      });
    }

    if (encryptedRows.length > 0 && candidates.length === 0 && decryptFailureCount > 0) {
      return c.json({ error: "private_memory_fragment_decrypt_failed" }, 503);
    }

    const rankingStartedAt = Date.now();
    const rawResults = retrieveRelevantMemories(candidates, {
      query,
      limit: Math.min((limit ?? 5) * 3, 20),
    });
    timing.rankingMs = Date.now() - rankingStartedAt;
    const dedupeStartedAt = Date.now();
    const { results, duplicateResultCount } = dedupeRetrievalResults(
      rawResults,
      limit,
      canonicalMemoryIdsByFragmentId,
    );
    timing.dedupeMs = Date.now() - dedupeStartedAt;
    timing.totalMs = Date.now() - startedAt;

    console.info("memory search completed", {
      twinId,
      mode,
      indexMatchCount,
      searchedFragmentCount: rows.length,
      encryptedFragmentCount: encryptedRows.length,
      selectedForDecryptCount: rowsSelectedForDecrypt.length,
      decryptedCandidateCount: candidates.length,
      decryptSkippedCount,
      decryptFailureCount,
      duplicateResultCount,
      resultCount: results.length,
      timing,
    });

    await db.insert(auditEvents).values({
      twinId,
      actorType: auth.type,
      actorId: auth.sub,
      eventType: "memory.search",
      resourceType: "twin",
      resourceId: twinId,
      metadata: {
        query,
        resultCount: results.length,
        duplicateResultCount,
        decryptFailureCount,
        decryptSkippedCount,
        searchMode: mode,
        indexMatchCount,
        searchedFragmentCount: rows.length,
        durationMs: timing.totalMs,
        timing,
        clientId: auth.clientId,
        agentScopeAccepted: AGENT_MEMORY_SEARCH_SCOPE,
        memoryFragmentIds: results.map((result) => result.memory.id),
        canonicalMemoryIds: results
          .map((result) => canonicalMemoryIdsByFragmentId.get(result.memory.id))
          .filter(Boolean),
      },
    });

    return c.json({
      query,
      results: results.map((result) => ({
        id: result.memory.id,
        sourceArtifactId: result.memory.sourceArtifactId,
        content: result.memory.content,
        score: result.score,
        matchedTerms: result.matchedTerms,
        canonicalMemoryId: canonicalMemoryIdsByFragmentId.get(result.memory.id) ?? null,
        citation: {
          sourceArtifactId: result.memory.sourceArtifactId,
        },
      })),
      policy: {
        rawArtifactsIncluded: false,
        scope: "memory:read",
        agentScopesAccepted: [AGENT_MEMORY_SEARCH_SCOPE],
        privateFragmentsSkipped: decryptFailureCount,
        searchMode: mode,
        indexMatchCount,
        searchedFragmentCount: rows.length,
        encryptedFragmentCount: encryptedRows.length,
        selectedForDecryptCount: rowsSelectedForDecrypt.length,
        decryptedCandidateCount: candidates.length,
        decryptSkippedCount,
        decryptEvidenceLimit: memorySearchConfig.decryptEvidenceLimit,
        duplicateResultsHidden: duplicateResultCount,
        timing,
      },
    });
  });

  return memoryRoutes;
}

function dedupeRetrievalResults(
  results: ReturnType<typeof retrieveRelevantMemories>,
  limit: number | undefined,
  canonicalMemoryIdsByFragmentId = new Map<string, string>(),
): {
  results: ReturnType<typeof retrieveRelevantMemories>;
  duplicateResultCount: number;
} {
  const maxResults = clampResultLimit(limit);
  const seen = new Set<string>();
  const uniqueResults: ReturnType<typeof retrieveRelevantMemories> = [];
  let duplicateResultCount = 0;

  for (const result of results) {
    const canonicalMemoryId = canonicalMemoryIdsByFragmentId.get(result.memory.id);
    const key = canonicalMemoryId
      ? `canonical:${canonicalMemoryId}`
      : normalizeRetrievedContent(result.memory.content);

    if (key && seen.has(key)) {
      duplicateResultCount += 1;
      continue;
    }

    if (key) {
      seen.add(key);
    }

    uniqueResults.push(result);

    if (uniqueResults.length >= maxResults) {
      break;
    }
  }

  return {
    results: uniqueResults,
    duplicateResultCount,
  };
}

function selectRowsForDecrypt(input: {
  rows: Array<typeof memoryFragments.$inferSelect>;
  canonicalMemoryIdsByFragmentId: Map<string, string>;
  limit: number | undefined;
  config: MemorySearchConfig;
}): Array<typeof memoryFragments.$inferSelect> {
  const maxRows = Math.min(clampResultLimit(input.limit), input.config.decryptEvidenceLimit);
  const selected: Array<typeof memoryFragments.$inferSelect> = [];
  const seenCanonicalIds = new Set<string>();
  const seenUnindexedRows = new Set<string>();

  for (const row of input.rows) {
    const canonicalMemoryId = input.canonicalMemoryIdsByFragmentId.get(row.id);

    if (canonicalMemoryId) {
      if (seenCanonicalIds.has(canonicalMemoryId)) {
        continue;
      }

      seenCanonicalIds.add(canonicalMemoryId);
    } else if (seenUnindexedRows.has(row.id)) {
      continue;
    } else {
      seenUnindexedRows.add(row.id);
    }

    selected.push(row);

    if (selected.length >= maxRows) {
      break;
    }
  }

  return selected;
}

async function loadCanonicalMemoryIdsByFragmentId(input: {
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

function normalizeRetrievedContent(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function clampResultLimit(limit: number | undefined): number {
  if (!limit) {
    return 5;
  }

  return Math.min(Math.max(Math.floor(limit), 1), 20);
}

async function loadSearchRows(input: {
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
          inArray(memoryFragments.id, shortlistedIds.slice(0, input.config.shortlistLimit)),
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
    .where(eq(memoryFragments.twinId, input.twinId))
    .orderBy(desc(memoryFragments.createdAt))
    .limit(input.config.fallbackLimit);

  return {
    rows,
    mode: "recent_fallback",
    indexMatchCount: 0,
  };
}

async function loadShortlistedMemoryFragmentIds(input: {
  db: AppDependencies["db"];
  twinId: string;
  queryTerms: string[];
  config: MemorySearchConfig;
}): Promise<string[]> {
  const terms = input.queryTerms.slice(0, 8);

  if (terms.length === 0) {
    return [];
  }

  const matchedNodes = await input.db
    .select({ id: graphNodes.id })
    .from(graphNodes)
    .where(
      and(
        eq(graphNodes.twinId, input.twinId),
        or(...terms.map((term) => graphNodeMatchesTerm(term))),
      ),
    )
    .limit(input.config.shortlistLimit);
  const matchedNodeIds = matchedNodes.map((node) => node.id);
  const memoryIds = new Set<string>();

  if (matchedNodeIds.length > 0) {
    const edges = await input.db
      .select({ evidenceMemoryIds: graphEdges.evidenceMemoryIds })
      .from(graphEdges)
      .where(
        and(
          eq(graphEdges.twinId, input.twinId),
          or(
            inArray(graphEdges.fromNodeId, matchedNodeIds),
            inArray(graphEdges.toNodeId, matchedNodeIds),
          ),
        ),
      )
      .limit(input.config.shortlistLimit * 4);

    for (const edge of edges) {
      for (const memoryId of edge.evidenceMemoryIds) {
        memoryIds.add(memoryId);
      }
    }
  }

  const matchedCandidateMemories = await input.db
    .select({ memoryFragmentId: candidateMemories.memoryFragmentId })
    .from(candidateMemories)
    .where(
      and(
        eq(candidateMemories.twinId, input.twinId),
        or(...terms.map((term) => candidateMemoryMatchesTerm(term))),
      ),
    )
    .limit(input.config.shortlistLimit);

  for (const candidate of matchedCandidateMemories) {
    memoryIds.add(candidate.memoryFragmentId);
  }

  return Array.from(memoryIds);
}

function orderRowsById<T extends { id: string }>(rows: T[], ids: string[]): T[] {
  const order = new Map(ids.map((id, index) => [id, index]));

  return [...rows].sort((left, right) =>
    (order.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
    (order.get(right.id) ?? Number.MAX_SAFE_INTEGER),
  );
}

function graphNodeMatchesTerm(term: string) {
  const pattern = `%${escapeLike(term)}%`;

  return sql`lower(${graphNodes.name}) like ${pattern} escape '\\' or lower(${graphNodes.normalizedName}) like ${pattern} escape '\\'`;
}

function candidateMemoryMatchesTerm(term: string) {
  const pattern = `%${escapeLike(term)}%`;

  return sql`lower(coalesce(${candidateMemories.metadata}->>'subject', '')) like ${pattern} escape '\\'`;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

async function mapSettledWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<Array<PromiseSettledResult<R>>> {
  const results = new Array<PromiseSettledResult<R>>(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      try {
        results[currentIndex] = {
          status: "fulfilled",
          value: await mapper(items[currentIndex]!),
        };
      } catch (reason) {
        results[currentIndex] = {
          status: "rejected",
          reason,
        };
      }
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(Math.max(concurrency, 1), items.length) },
      () => worker(),
    ),
  );

  return results;
}

function toCandidate(
  row: typeof memoryFragments.$inferSelect,
  privateMemoryReader: AppDependencies["privateMemoryReader"],
): Promise<MemoryCandidate | null> {
  if (!row.contentStorageRef) {
    return Promise.resolve(null);
  }

  if (!privateMemoryReader) {
    return Promise.resolve(null);
  }

  const content = privateMemoryReader.readPrivateMemory({
    rawStorageRef: row.contentStorageRef,
    artifactId: row.sourceArtifactId,
    twinId: row.twinId,
    expectedCiphertextSha256: row.contentSha256,
  });

  return content.then((decryptedContent) => ({
    id: row.id,
    twinId: row.twinId,
    sourceArtifactId: row.sourceArtifactId,
    content: decryptedContent,
    importanceScore: row.importanceScore,
    confidenceScore: row.confidenceScore,
    occurredAt: row.occurredAt,
    createdAt: row.createdAt,
  }));
}

function requiredString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function optionalLimit(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}
