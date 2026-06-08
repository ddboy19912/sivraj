import type { IntelligenceChunk } from "../types/ingestion.types.js";
import { readNumber } from "./readers.js";
import { readStringArray } from "./readers.js";

export function createIntelligenceChunks(content: string, chunkChars: number): IntelligenceChunk[] {
  const normalizedChunkChars = Math.max(1_000, chunkChars);

  if (content.length <= normalizedChunkChars) {
    return [
      {
        index: 0,
        total: 1,
        startOffset: 0,
        endOffset: content.length,
        content,
      },
    ];
  }

  const chunks: IntelligenceChunk[] = [];
  let startOffset = 0;

  while (startOffset < content.length) {
    const hardEnd = Math.min(content.length, startOffset + normalizedChunkChars);
    const nextBreak = findChunkBreak(content, startOffset, hardEnd);
    const endOffset = nextBreak > startOffset ? nextBreak : hardEnd;
    const chunkContent = content.slice(startOffset, endOffset).trim();

    if (chunkContent) {
      chunks.push({
        index: chunks.length,
        total: 0,
        startOffset,
        endOffset,
        content: chunkContent,
      });
    }

    startOffset = endOffset;
  }

  return chunks.map((chunk) => ({
    ...chunk,
    total: chunks.length,
  }));
}

function findChunkBreak(content: string, startOffset: number, hardEnd: number): number {
  if (hardEnd >= content.length) {
    return content.length;
  }

  const searchStart = Math.max(startOffset, hardEnd - 2_000);
  const paragraphBreak = content.lastIndexOf("\n\n", hardEnd);

  if (paragraphBreak >= searchStart) {
    return paragraphBreak + 2;
  }

  const sentenceBreak = content.lastIndexOf(". ", hardEnd);

  if (sentenceBreak >= searchStart) {
    return sentenceBreak + 2;
  }

  const lineBreak = content.lastIndexOf("\n", hardEnd);

  if (lineBreak >= searchStart) {
    return lineBreak + 1;
  }

  const spaceBreak = content.lastIndexOf(" ", hardEnd);

  return spaceBreak >= searchStart ? spaceBreak + 1 : hardEnd;
}

export async function mapWithConcurrency<TInput, TOutput>(
  items: TInput[],
  concurrency: number,
  task: (item: TInput) => Promise<TOutput>,
): Promise<TOutput[]> {
  const limit = Math.max(1, concurrency);
  const results = new Array<TOutput>(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await task(items[currentIndex]!);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );

  return results;
}

export function aggregateExtractionResults(
  results: Array<Record<string, unknown> | null>,
  options: {
    countKey: "entityCount" | "candidateMemoryCount";
    chunkCount: number;
  },
): Record<string, unknown> | null {
  const present = results.filter((result): result is Record<string, unknown> => Boolean(result));

  if (present.length === 0) {
    return null;
  }

  const failedCount = present.filter((result) => result.status === "failed").length;
  const completedCount = present.filter((result) => result.status === "completed").length;
  const first = present[0] ?? {};

  return {
    status: failedCount > 0 && completedCount === 0 ? "failed" : "completed",
    ...(failedCount > 0 ? { failedChunkCount: failedCount } : {}),
    chunkCount: options.chunkCount,
    completedChunkCount: completedCount,
    [options.countKey]: present.reduce((sum, result) => sum + readNumber(result[options.countKey]), 0),
    ...(typeof first.extractor === "string" ? { extractor: first.extractor } : {}),
    ...(typeof first.provider === "string" ? { provider: first.provider } : {}),
    ...(typeof first.model === "string" ? { model: first.model } : {}),
    warnings: present.flatMap((result) => readStringArray(result.warnings)),
    llmMs: present.reduce((sum, result) => sum + readNumber(result.llmMs), 0),
    regularMemoryCount: present.reduce((sum, result) => sum + readNumber(result.regularMemoryCount), 0),
    engineeringMemoryCount: present.reduce((sum, result) => sum + readNumber(result.engineeringMemoryCount), 0),
    engineeringExtractionMs: present.reduce((sum, result) => sum + readNumber(result.engineeringExtractionMs), 0),
    graphWriteMs: present.reduce((sum, result) => sum + readNumber(result.graphWriteMs), 0),
    candidateMemoryEncryptMs: present.reduce((sum, result) => sum + readNumber(result.candidateMemoryEncryptMs), 0),
    candidateMemoryDbWriteMs: present.reduce((sum, result) => sum + readNumber(result.candidateMemoryDbWriteMs), 0),
    candidateMemoryArchiveQueued: present.some((result) => result.candidateMemoryArchiveQueued === true),
  };
}

export async function measureStage<T>(
  key: string,
  timings: Record<string, number>,
  task: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now();

  try {
    return await task();
  } finally {
    timings[key] = Date.now() - startedAt;
  }
}
