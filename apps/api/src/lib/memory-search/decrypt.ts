import type { MemoryCandidate } from "@sivraj/retrieval";
import { memoryFragments } from "@sivraj/db";
import type { AppDependencies } from "../../app.js";

export async function mapSettledWithConcurrency<T, R>(
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

export function toMemorySearchCandidate(
  row: typeof memoryFragments.$inferSelect,
  privateMemoryReader: AppDependencies["privateMemoryReader"],
): Promise<MemoryCandidate | null> {
  if (!row.contentStorageRef || !privateMemoryReader) {
    return Promise.resolve(null);
  }

  return privateMemoryReader.readPrivateMemory({
    rawStorageRef: row.contentStorageRef,
    artifactId: row.sourceArtifactId,
    twinId: row.twinId,
    expectedCiphertextSha256: row.contentSha256,
  }).then((decryptedContent) => ({
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
