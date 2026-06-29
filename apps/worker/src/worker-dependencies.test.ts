import { describe, expect, it, vi } from "vitest";

vi.mock("./db.js", () => ({
  createWorkerDb: () => ({
    db: {},
    close: async () => undefined,
  }),
}));

vi.mock("./repository.js", () => ({
  createDrizzleArtifactRepository: () => ({}),
}));

vi.mock("@sivraj/private-memory-reader", () => ({
  createConfiguredPrivateMemoryReader: () => ({}),
}));

vi.mock("./private-fragment-storage.js", () => ({
  createConfiguredPrivateFragmentStorage: () => ({}),
}));

vi.mock("./private-source-storage.js", () => ({
  createConfiguredPrivateSourceStorage: () => ({}),
}));

vi.mock("@sivraj/llm", () => ({
  createConfiguredSpeechToTextTranscriber: () => null,
  createConfiguredStructuredGenerator: () => null,
  createConfiguredTextEmbedder: () => null,
}));

vi.mock("@sivraj/queue", () => ({
  createPrivateMemoryCiphertextCache: () => ({
    close: async () => undefined,
  }),
  createIntelligenceProcessingQueue: () => ({
    close: async () => undefined,
  }),
}));

vi.mock("./ingestion-processor.js", () => ({
  createCanonicalMemoryMergeJudge: () => undefined,
  createEntityExtractor: () => undefined,
  createEngineeringMemoryExtractor: () => undefined,
  createMemoryExtractor: () => undefined,
  processQueuedArtifacts: async () => ({ scanned: 0, queued: 0 }),
}));

describe("prepareWorkerBootstrapInput", () => {
  it("reads worker runtime configuration", async () => {
    process.env.REDIS_URL = "redis://localhost:6379";
    process.env.WORKER_DRAIN_EXISTING_ON_BOOT = "false";

    const { prepareWorkerBootstrapInput } = await import("./worker-dependencies.js");
    const input = await prepareWorkerBootstrapInput("sivraj-worker");

    expect(input.redisUrl).toBe("redis://localhost:6379");
    expect(input.concurrency).toBeGreaterThan(0);
  });
});
