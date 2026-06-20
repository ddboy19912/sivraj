import type { ChatMemoryContext } from "../../types/chat.types.js";
import type { MemoryTokenAccounting } from "./turn-types.js";
import { estimateTextTokens, truncate } from "./helpers.js";
import { readNonNegativeNumber } from "./document-formatters.js";
import { readRecord } from "../http/route-helpers.js";

export const CHAT_MEMORY_CONTEXT_CHAR_LIMIT = 900;

export function readMemoryTokenAccounting(
  metadata: unknown,
  memoryContent: string,
): MemoryTokenAccounting {
  const memoryContextTokens = estimateTextTokens(truncate(memoryContent, CHAT_MEMORY_CONTEXT_CHAR_LIMIT));
  const tokenAccounting = readRecord(metadata)?.["tokenAccounting"];
  const tokenAccountingRecord = readRecord(tokenAccounting);
  const sourceTokensRepresented = readNonNegativeNumber(tokenAccountingRecord?.["sourceTokensRepresented"]);
  if (sourceTokensRepresented === null) {
    return {
      sourceTokensRepresented: memoryContextTokens,
      memoryContextTokens,
    };
  }
  return {
    sourceTokensRepresented,
    memoryContextTokens,
  };
}

export function readCandidateMemoryTokenAccounting(
  metadata: unknown,
  memoryContent: string,
): MemoryTokenAccounting {
  const tokenAccounting = readRecord(metadata)?.["tokenAccounting"];
  const tokenAccountingRecord = readRecord(tokenAccounting);
  const sourceTokensRepresented = readNonNegativeNumber(tokenAccountingRecord?.["sourceTokensRepresented"]);
  const memoryContextTokens = estimateTextTokens(truncate(memoryContent, CHAT_MEMORY_CONTEXT_CHAR_LIMIT));
  return {
    sourceTokensRepresented: sourceTokensRepresented ?? memoryContextTokens,
    memoryContextTokens,
  };
}

/** Estimate prompt tokens saved by using memory summaries instead of raw source text. */
export function estimateMemoryTokenSavings(memoryContext: ChatMemoryContext) {
  const selectedAccounting = memoryContext.results.map((result) => memoryContext.tokenAccountingByMemoryId.get(result.memory.id)
    ?? readMemoryTokenAccounting(null, result.memory.content));
  const sourceTokensRepresented = selectedAccounting.reduce(
    (total, accounting) => total + accounting.sourceTokensRepresented,
    0,
  );
  const memoryContextTokens = selectedAccounting.reduce(
    (total, accounting) => total + accounting.memoryContextTokens,
    0,
  );
  const sourceDeltaTokensSaved = Math.max(sourceTokensRepresented - memoryContextTokens, 0);
  const estimatedTokensSaved = sourceDeltaTokensSaved > 0
    ? sourceDeltaTokensSaved
    : memoryContextTokens;
  return {
    method: "source_vs_memory_estimate" as const,
    estimatedTokensSaved,
    sourceTokensRepresented,
    memoryContextTokens,
    memoryCount: memoryContext.results.length,
    compressionRatio: memoryContextTokens > 0
      ? Number((sourceTokensRepresented / memoryContextTokens).toFixed(2))
      : null,
  };
}
