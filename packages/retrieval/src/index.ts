export type MemoryCandidate = {
  id: string;
  twinId: string;
  sourceArtifactId: string;
  content: string;
  summary?: string | null;
  importanceScore: number | null;
  confidenceScore: number | null;
  occurredAt: Date | null;
  createdAt: Date;
};

export type RetrievalQuery = {
  query: string;
  limit?: number;
};

export type RetrievalResult = {
  memory: MemoryCandidate;
  score: number;
  matchedTerms: string[];
};

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "for",
  "from",
  "how",
  "i",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "this",
  "to",
  "what",
  "when",
  "with",
]);

export function retrieveRelevantMemories(
  candidates: MemoryCandidate[],
  query: RetrievalQuery,
): RetrievalResult[] {
  const terms = tokenize(query.query);
  const limit = clampLimit(query.limit);

  if (terms.length === 0) {
    return [];
  }

  return candidates
    .map((memory) => scoreMemory(memory, terms))
    .filter((result) => result.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
}

export function tokenize(value: string): string[] {
  return Array.from(
    new Set(
      value
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .map((term) => term.trim())
        .filter((term) => term.length > 1 && !STOP_WORDS.has(term)),
    ),
  );
}

function scoreMemory(memory: MemoryCandidate, terms: string[]): RetrievalResult {
  const contentTerms = tokenize(memory.content);
  const summaryTerms = tokenize(memory.summary ?? "");
  const contentSet = new Set(contentTerms);
  const summarySet = new Set(summaryTerms);
  const matchedTerms = terms.filter((term) => contentSet.has(term) || summarySet.has(term));
  const contentScore = terms.reduce((score, term) => {
    if (contentSet.has(term)) {
      return score + 1;
    }

    return score;
  }, 0);
  const summaryScore = terms.reduce((score, term) => {
    if (summarySet.has(term)) {
      return score + 1.4;
    }

    return score;
  }, 0);
  const phraseScore = memory.content.toLowerCase().includes(terms.join(" ")) ? 1.5 : 0;

  if (matchedTerms.length === 0 && phraseScore === 0) {
    return {
      memory,
      score: 0,
      matchedTerms,
    };
  }

  const qualityScore =
    (memory.importanceScore ?? 0.5) * 0.25 + (memory.confidenceScore ?? 0.5) * 0.25;
  const recencyScore = recencyBoost(memory.occurredAt ?? memory.createdAt);

  return {
    memory,
    score: Number((contentScore + summaryScore + phraseScore + qualityScore + recencyScore).toFixed(4)),
    matchedTerms,
  };
}

function recencyBoost(date: Date): number {
  const ageMs = Date.now() - date.getTime();
  const ageDays = Math.max(0, ageMs / 86_400_000);

  if (ageDays < 7) {
    return 0.2;
  }

  if (ageDays < 30) {
    return 0.1;
  }

  return 0;
}

function clampLimit(limit: number | undefined): number {
  if (!limit) {
    return 5;
  }

  return Math.min(Math.max(Math.floor(limit), 1), 20);
}
