import { retrieveRelevantMemories, type MemoryCandidate } from "@sivraj/retrieval";

export function clampResultLimit(limit: number | undefined): number {
  if (!limit) {
    return 5;
  }

  return Math.min(Math.max(Math.floor(limit), 1), 20);
}

export function normalizeRetrievedContent(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function dedupeRetrievalResults(
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

export function selectRowsForDecrypt<T extends { id: string }>(input: {
  rows: T[];
  canonicalMemoryIdsByFragmentId: Map<string, string>;
  limit: number | undefined;
  decryptEvidenceLimit: number;
}): T[] {
  const maxRows = Math.min(clampResultLimit(input.limit), input.decryptEvidenceLimit);
  const selected: T[] = [];
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

export function shouldRejectSearchAfterDecryptFailures(input: {
  encryptedRowCount: number;
  candidateCount: number;
  decryptFailureCount: number;
}) {
  return input.encryptedRowCount > 0 &&
    input.candidateCount === 0 &&
    input.decryptFailureCount > 0;
}

export function mapMemorySearchResults(
  results: ReturnType<typeof retrieveRelevantMemories>,
  canonicalMemoryIdsByFragmentId: Map<string, string>,
) {
  return results.map((result) => ({
    id: result.memory.id,
    sourceArtifactId: result.memory.sourceArtifactId,
    content: result.memory.content,
    score: result.score,
    matchedTerms: result.matchedTerms,
    canonicalMemoryId: canonicalMemoryIdsByFragmentId.get(result.memory.id) ?? null,
    citation: {
      sourceArtifactId: result.memory.sourceArtifactId,
    },
  }));
}

export function buildMemorySearchPolicy(input: {
  mode: string;
  indexMatchCount: number;
  rows: unknown[];
  encryptedRowCount: number;
  selectedForDecryptCount: number;
  decryptedCandidateCount: number;
  decryptSkippedCount: number;
  decryptFailureCount: number;
  duplicateResultCount: number;
  decryptEvidenceLimit: number;
  timing: Record<string, number>;
  agentScopeAccepted: string;
}) {
  return {
    rawArtifactsIncluded: false,
    scope: "memory:read",
    agentScopesAccepted: [input.agentScopeAccepted],
    privateFragmentsSkipped: input.decryptFailureCount,
    searchMode: input.mode,
    indexMatchCount: input.indexMatchCount,
    searchedFragmentCount: input.rows.length,
    encryptedFragmentCount: input.encryptedRowCount,
    selectedForDecryptCount: input.selectedForDecryptCount,
    decryptedCandidateCount: input.decryptedCandidateCount,
    decryptSkippedCount: input.decryptSkippedCount,
    decryptEvidenceLimit: input.decryptEvidenceLimit,
    duplicateResultsHidden: input.duplicateResultCount,
    timing: input.timing,
  };
}

export function collectDecryptedCandidates(
  candidateResults: Array<PromiseSettledResult<MemoryCandidate | null>>,
) {
  const decryptFailureCount = candidateResults.filter(
    (result) => result.status === "rejected",
  ).length;
  const candidates = candidateResults
    .flatMap((result) => result.status === "fulfilled" ? [result.value] : [])
    .filter((candidate): candidate is MemoryCandidate => candidate !== null);

  return { candidates, decryptFailureCount };
}

export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}
