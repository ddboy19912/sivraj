export type DocumentToolMatchMode = "whole_word" | "phrase" | "substring" | null | undefined;

export type DocumentExactSearchPage = {
  pageNumber: number;
  content: string;
};

export type DocumentExactSearchReportInput = {
  sourceContent: string;
  pages: DocumentExactSearchPage[];
  query: string;
  matchMode: DocumentToolMatchMode;
  sampleLimit: number;
  title: string | null;
  fileName: string | null;
  pageCount: number | null;
  pagesTruncated: boolean;
};

export type DocumentExactMatchResult = {
  count: number;
  samples: string[];
};

/**
 * Execute Sivraj's exact-search/count document tool.
 *
 * Scope:
 * - Counts a planner-supplied literal word/name/phrase against the full extracted document text.
 * - Builds a report for the answer model with an exact total, optional page distribution,
 *   and bounded sample contexts.
 *
 * Non-scope:
 * - Does not decide whether the user's message needs exact search. The LLM planner owns
 *   semantic intent and supplies `exactQuery` plus `matchMode`.
 * - Does not read private storage or the database. Callers pass already-authorized text.
 */
export function buildExactDocumentSearchReport(input: DocumentExactSearchReportInput) {
  const fullDocumentResult = findExactDocumentMatches({
    content: input.sourceContent,
    query: input.query,
    matchMode: input.matchMode,
    sampleLimit: input.pages.length > 0 ? 0 : input.sampleLimit,
  });
  const pageResults = input.pages
    .map((page) => ({
      pageNumber: page.pageNumber,
      ...findExactDocumentMatches({
        content: page.content,
        query: input.query,
        matchMode: input.matchMode,
        sampleLimit: Math.max(input.sampleLimit, 1),
      }),
    }))
    .filter((page) => page.count > 0);
  const sampleContexts = pageResults
    .flatMap((page) => page.samples.map((sample) => ({
      pageNumber: page.pageNumber,
      text: sample,
    })))
    .slice(0, input.sampleLimit);
  const pageDistribution = pageResults
    .slice(0, 80)
    .map((page) => `- Page ${page.pageNumber}: ${page.count}`);

  return [
    "Exact document search report.",
    `Query: ${input.query}`,
    `Match mode: ${input.matchMode ?? "whole_word"}`,
    `Total matches: ${fullDocumentResult.count}`,
    input.title ? `Title: ${input.title}` : null,
    input.fileName ? `File name: ${input.fileName}` : null,
    input.pageCount ? `Page count: ${input.pageCount}` : null,
    input.pagesTruncated ? `Warning: page distribution was limited to the first ${input.pages.length} indexed pages.` : null,
    "",
    "Page distribution:",
    pageDistribution.length > 0 ? pageDistribution.join("\n") : "- No page-level matches.",
    "",
    "Sample contexts:",
    sampleContexts.length > 0
      ? sampleContexts.map((sample) => `- Page ${sample.pageNumber}: ${sample.text}`).join("\n")
      : fullDocumentResult.samples.length
        ? fullDocumentResult.samples.map((sample) => `- ${sample}`).join("\n")
        : "- No sample contexts.",
  ].filter((line): line is string => line !== null).join("\n");
}

/**
 * Count exact occurrences of a planner-supplied literal query in document text.
 *
 * `whole_word` is intended for names and standalone words, `phrase` allows flexible
 * whitespace inside the phrase, and `substring` intentionally counts contained text.
 */
export function countExactDocumentMatches(
  content: string,
  query: string,
  matchMode: DocumentToolMatchMode = "whole_word",
) {
  return findExactDocumentMatches({
    content,
    query,
    matchMode,
    sampleLimit: 0,
  }).count;
}

/**
 * Return exact-match count plus bounded context snippets.
 *
 * This is execution logic for an already-selected document tool. It must not be used
 * as a semantic router for user messages.
 */
export function findExactDocumentMatches(input: {
  content: string;
  query: string;
  matchMode: DocumentToolMatchMode;
  sampleLimit: number;
}): DocumentExactMatchResult {
  const regex = buildExactDocumentSearchRegex(input.query, input.matchMode);
  if (!regex) {
    return { count: 0, samples: [] };
  }
  let count = 0;
  const samples: string[] = [];
  for (const match of input.content.matchAll(regex)) {
    count += 1;
    if (samples.length < input.sampleLimit) {
      const index = typeof match.index === "number" ? match.index : 0;
      samples.push(formatExactSearchSample(input.content, index, match[0]?.length ?? input.query.length));
    }
  }
  return { count, samples };
}

function buildExactDocumentSearchRegex(
  query: string,
  matchMode: DocumentToolMatchMode,
) {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    return null;
  }
  const flexibleWhitespaceQuery = escapeRegExp(normalizedQuery).replace(/\s+/gu, "\\s+");
  if (matchMode === "substring") {
    return new RegExp(flexibleWhitespaceQuery, "giu");
  }
  if (matchMode === "phrase") {
    return new RegExp(flexibleWhitespaceQuery, "giu");
  }
  return new RegExp(`(?<![\\p{L}\\p{N}_])${flexibleWhitespaceQuery}(?![\\p{L}\\p{N}_])`, "giu");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function formatExactSearchSample(content: string, matchIndex: number, matchLength: number) {
  const start = Math.max(0, matchIndex - 80);
  const end = Math.min(content.length, matchIndex + matchLength + 80);
  return content
    .slice(start, end)
    .replace(/\s+/gu, " ")
    .trim();
}
