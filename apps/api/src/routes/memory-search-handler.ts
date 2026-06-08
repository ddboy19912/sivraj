import {
  retrieveRelevantMemories,
  tokenize,
} from "@sivraj/retrieval";
import { AGENT_MEMORY_SEARCH_SCOPE } from "@sivraj/auth";
import { auditEvents } from "@sivraj/db";
import type { MemorySearchConfig } from "@sivraj/config";
import type { Context } from "hono";
import type { AppDependencies } from "../app.js";
import { hasActiveAgentGrantForScopes } from "../lib/agent-grants.js";
import type { AuthEnv } from "../middleware/auth.js";
import { authorizeTwinRouteWithAnyScope } from "../lib/http/route-auth.js";
import {
  buildMemorySearchPolicy,
  collectDecryptedCandidates,
  dedupeRetrievalResults,
  mapMemorySearchResults,
  selectRowsForDecrypt,
  shouldRejectSearchAfterDecryptFailures,
} from "../lib/memory-search/helpers.js";
import {
  optionalMemorySearchLimit,
  parseMemorySearchRequestBody,
} from "../lib/memory-search/request.js";
import {
  loadCanonicalMemoryIdsByFragmentId,
  loadSearchRows,
  rankMemorySearchResults,
} from "../lib/memory-search/load.js";
import { mapSettledWithConcurrency, toMemorySearchCandidate } from "../lib/memory-search/decrypt.js";

export { escapeLike } from "../lib/memory-search/helpers.js";
export { orderRowsById } from "../lib/memory-search/load.js";

export function readMemorySearchPrivateReaderError(input: {
  encryptedRowCount: number;
  privateMemoryReader: AppDependencies["privateMemoryReader"];
}) {
  if (input.encryptedRowCount > 0 && !input.privateMemoryReader) {
    return { status: 503 as const, body: { error: "private_memory_reader_not_configured" } };
  }

  return null;
}

export function buildMemorySearchAuditMetadata(input: {
  query: string;
  results: Array<{ memory: { id: string } }>;
  duplicateResultCount: number;
  decryptFailureCount: number;
  decryptSkippedCount: number;
  mode: "index_shortlist" | "recent_fallback";
  indexMatchCount: number;
  searchedFragmentCount: number;
  timing: Record<string, number>;
  auth: { type: string; sub: string; clientId?: string | null };
  canonicalMemoryIdsByFragmentId: Map<string, string>;
}) {
  return {
    query: input.query,
    resultCount: input.results.length,
    duplicateResultCount: input.duplicateResultCount,
    decryptFailureCount: input.decryptFailureCount,
    decryptSkippedCount: input.decryptSkippedCount,
    searchMode: input.mode,
    indexMatchCount: input.indexMatchCount,
    searchedFragmentCount: input.searchedFragmentCount,
    durationMs: input.timing.totalMs,
    timing: input.timing,
    clientId: input.auth.clientId,
    agentScopeAccepted: AGENT_MEMORY_SEARCH_SCOPE,
    memoryFragmentIds: input.results.map((result) => result.memory.id),
    canonicalMemoryIds: input.results
      .map((result) => input.canonicalMemoryIdsByFragmentId.get(result.memory.id))
      .filter(Boolean),
  };
}

export function buildMemorySearchResponse(input: {
  query: string;
  results: ReturnType<typeof retrieveRelevantMemories>;
  canonicalMemoryIdsByFragmentId: Map<string, string>;
  mode: "index_shortlist" | "recent_fallback";
  indexMatchCount: number;
  rows: Array<unknown>;
  encryptedRowCount: number;
  selectedForDecryptCount: number;
  decryptedCandidateCount: number;
  decryptSkippedCount: number;
  decryptFailureCount: number;
  duplicateResultCount: number;
  decryptEvidenceLimit: number;
  timing: Record<string, number>;
}) {
  return {
    query: input.query,
    results: mapMemorySearchResults(input.results, input.canonicalMemoryIdsByFragmentId),
    policy: buildMemorySearchPolicy({
      mode: input.mode,
      indexMatchCount: input.indexMatchCount,
      rows: input.rows,
      encryptedRowCount: input.encryptedRowCount,
      selectedForDecryptCount: input.selectedForDecryptCount,
      decryptedCandidateCount: input.decryptedCandidateCount,
      decryptSkippedCount: input.decryptSkippedCount,
      decryptFailureCount: input.decryptFailureCount,
      duplicateResultCount: input.duplicateResultCount,
      decryptEvidenceLimit: input.decryptEvidenceLimit,
      timing: input.timing,
      agentScopeAccepted: AGENT_MEMORY_SEARCH_SCOPE,
    }),
  };
}

export async function handleMemorySearchRequest(
  c: Context<AuthEnv>,
  input: {
    db: AppDependencies["db"];
    privateMemoryReader: AppDependencies["privateMemoryReader"];
    memorySearchConfig: MemorySearchConfig;
  },
) {
  const routeAuth = authorizeTwinRouteWithAnyScope(c, [
    "memory:read",
    AGENT_MEMORY_SEARCH_SCOPE,
  ]);

  if (!routeAuth.ok) {
    return routeAuth.response;
  }

  const { auth, twinId } = routeAuth.value;

  if (!await hasActiveAgentGrantForScopes({
    db: input.db,
    auth,
    twinId,
    acceptedScopes: [AGENT_MEMORY_SEARCH_SCOPE],
  })) {
    return c.json({ error: "agent_grant_inactive" }, 403);
  }

  const parsed = await parseMemorySearchInput(c);

  if ("response" in parsed) {
    return parsed.response;
  }

  const search = await executeMemorySearch(c, { ...input, twinId, ...parsed });

  if ("response" in search) {
    return search.response;
  }

  await input.db.insert(auditEvents).values({
    twinId,
    actorType: auth.type,
    actorId: auth.sub,
    eventType: "memory.search",
    resourceType: "twin",
    resourceId: twinId,
    metadata: buildMemorySearchAuditMetadata({
      ...search,
      query: parsed.query,
      auth,
    }),
  });

  return c.json(buildMemorySearchResponse({
    query: parsed.query,
    ...search,
    decryptEvidenceLimit: input.memorySearchConfig.decryptEvidenceLimit,
  }));
}

async function parseMemorySearchInput(c: Context<AuthEnv>) {
  const body = await c.req.json().catch(() => null);
  const parsedRequest = parseMemorySearchRequestBody(body);

  if (!parsedRequest.ok) {
    return { response: c.json(parsedRequest.error.body, parsedRequest.error.status) };
  }

  return {
    query: parsedRequest.query,
    limit: optionalMemorySearchLimit(
      body && typeof body === "object" ? body["limit"] : undefined,
    ),
  };
}

async function executeMemorySearch(
  c: Context<AuthEnv>,
  input: {
    db: AppDependencies["db"];
    privateMemoryReader: AppDependencies["privateMemoryReader"];
    memorySearchConfig: MemorySearchConfig;
    twinId: string;
    query: string;
    limit: number | undefined;
  },
) {
  const startedAt = Date.now();
  const timing: Record<string, number> = {};
  const queryTerms = tokenize(input.query);
  timing.tokenizeMs = Date.now() - startedAt;
  const shortlistStartedAt = Date.now();
  const { rows, mode, indexMatchCount } = await loadSearchRows({
    db: input.db,
    twinId: input.twinId,
    queryTerms,
    config: input.memorySearchConfig,
  });
  timing.shortlistMs = Date.now() - shortlistStartedAt;
  const encryptedRows = rows.filter((row) => row.contentStorageRef);
  const readerError = readMemorySearchPrivateReaderError({
    encryptedRowCount: encryptedRows.length,
    privateMemoryReader: input.privateMemoryReader,
  });

  if (readerError) {
    return { response: c.json(readerError.body, readerError.status) };
  }

  const ranked = await rankAndDecryptMemorySearch(c, {
    ...input,
    rows,
    mode,
    indexMatchCount,
    encryptedRows,
    timing,
    startedAt,
  });

  return ranked;
}

async function rankAndDecryptMemorySearch(
  c: Context<AuthEnv>,
  input: {
    db: AppDependencies["db"];
    privateMemoryReader: AppDependencies["privateMemoryReader"];
    memorySearchConfig: MemorySearchConfig;
    twinId: string;
    query: string;
    limit: number | undefined;
    rows: Awaited<ReturnType<typeof loadSearchRows>>["rows"];
    mode: "index_shortlist" | "recent_fallback";
    indexMatchCount: number;
    encryptedRows: Awaited<ReturnType<typeof loadSearchRows>>["rows"];
    timing: Record<string, number>;
    startedAt: number;
  },
) {
  const canonicalLookupStartedAt = Date.now();
  const canonicalMemoryIdsByFragmentId = await loadCanonicalMemoryIdsByFragmentId({
    db: input.db,
    twinId: input.twinId,
    memoryFragmentIds: input.rows.map((row) => row.id),
  });
  input.timing.canonicalLookupMs = Date.now() - canonicalLookupStartedAt;
  const rowsSelectedForDecrypt = selectRowsForDecrypt({
    rows: input.rows,
    canonicalMemoryIdsByFragmentId,
    limit: input.limit,
    decryptEvidenceLimit: input.memorySearchConfig.decryptEvidenceLimit,
  });
  const decryptSkippedCount = Math.max(input.rows.length - rowsSelectedForDecrypt.length, 0);
  const decryptStartedAt = Date.now();
  const candidateResults = await mapSettledWithConcurrency(
    rowsSelectedForDecrypt,
    input.memorySearchConfig.decryptConcurrency,
    (row) => toMemorySearchCandidate(row, input.privateMemoryReader),
  );
  input.timing.decryptMs = Date.now() - decryptStartedAt;
  const { candidates, decryptFailureCount } = collectDecryptedCandidates(candidateResults);

  if (shouldRejectSearchAfterDecryptFailures({
    encryptedRowCount: input.encryptedRows.length,
    candidateCount: candidates.length,
    decryptFailureCount,
  })) {
    return { response: c.json({ error: "private_memory_fragment_decrypt_failed" }, 503) };
  }

  const rankingStartedAt = Date.now();
  const rawResults = rankMemorySearchResults(candidates, input.query, input.limit);
  input.timing.rankingMs = Date.now() - rankingStartedAt;
  const dedupeStartedAt = Date.now();
  const { results, duplicateResultCount } = dedupeRetrievalResults(
    rawResults,
    input.limit,
    canonicalMemoryIdsByFragmentId,
  );
  input.timing.dedupeMs = Date.now() - dedupeStartedAt;
  input.timing.totalMs = Date.now() - input.startedAt;

  return {
    results,
    canonicalMemoryIdsByFragmentId,
    mode: input.mode,
    indexMatchCount: input.indexMatchCount,
    searchedFragmentCount: input.rows.length,
    rows: input.rows,
    encryptedRowCount: input.encryptedRows.length,
    selectedForDecryptCount: rowsSelectedForDecrypt.length,
    decryptedCandidateCount: candidates.length,
    decryptSkippedCount,
    decryptFailureCount,
    duplicateResultCount,
    timing: input.timing,
  };
}
