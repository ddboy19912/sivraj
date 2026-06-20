import { optionalString, readRecord } from "../http/route-helpers.js";
import { truncate } from "./helpers.js";
import type { DocumentNavigationTarget } from "./turn-types.js";

export function readNonNegativeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

export function readDocumentSourceMetadata(metadata: unknown) {
  const record = readRecord(metadata);
  const processing = readRecord(record["processing"]);
  const parser = readRecord(processing["parser"]);
  const document = readRecord(parser["document"]);
  return {
    title: optionalString(document["title"]),
    fileName: optionalString(record["fileName"]),
    pageCount: readDocumentPageCount(document["pageCount"]),
  };
}

export function readDocumentPageCount(value: unknown): number | null {
  const pageCount = readNonNegativeNumber(value);
  return pageCount && pageCount > 0 ? pageCount : null;
}

export function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

export function formatScanPageRange(pageStart: number | null, pageEnd: number | null): string {
  if (!pageStart) {
    return "Pages unknown";
  }
  return pageEnd && pageEnd !== pageStart
    ? `Pages ${pageStart}-${pageEnd}`
    : `Page ${pageStart}`;
}

export function formatDocumentQueryScanReport(input: {
  query: string;
  task: string;
  target: DocumentNavigationTarget;
  title: string | null;
  fileName: string | null;
  pageCount: number | null;
  evidence: Array<{
    pageStart: number | null;
    pageEnd: number | null;
    confidence: number;
    evidence: string[];
    partialAnswer: string | null;
  }>;
  charLimit: number;
}): string {
  if (input.evidence.length === 0) {
    return "";
  }
  const lines = [
    "Query-specific document inspection report.",
    `Query: ${input.query}`,
    `Task: ${input.task}`,
    `Target: ${JSON.stringify(input.target)}`,
    input.title ? `Title: ${input.title}` : null,
    input.fileName ? `File name: ${input.fileName}` : null,
    input.pageCount ? `Page count: ${input.pageCount}` : null,
    "",
    "Relevant evidence:",
    ...input.evidence.flatMap((result) => {
      const location = formatScanPageRange(result.pageStart, result.pageEnd);
      return [
        `${location}; confidence=${result.confidence}`,
        ...result.evidence.map((item) => `- ${item}`),
        result.partialAnswer ? `Partial answer: ${result.partialAnswer}` : null,
      ].filter((line): line is string => Boolean(line));
    }),
  ].filter((line): line is string => line !== null);
  return truncate(lines.join("\n"), input.charLimit);
}
