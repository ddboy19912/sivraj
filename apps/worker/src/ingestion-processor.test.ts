import { describe, expect, it } from "vitest";
import { WalrusStorageError } from "@sivraj/storage-walrus";
import {
  enqueueDueCandidateMemoryArchives,
  processCandidateMemoryArchive,
  processArtifact,
  RetryableArtifactProcessingError,
  throwIfArtifactIntelligenceFailed,
} from "./ingestion-processor.js";
import type { ArtifactRepository } from "./types/ingestion.types.js";

describe("throwIfArtifactIntelligenceFailed", () => {
  it("keeps failed intelligence jobs retryable", () => {
    expect(() => throwIfArtifactIntelligenceFailed("artifact-1", {
      status: "failed",
      memoryExtraction: {
        status: "failed",
        reason: "memory_extraction_failed",
        errorMessage: "fetch failed",
      },
    })).toThrow(RetryableArtifactProcessingError);
  });

  it("does not throw for completed intelligence jobs", () => {
    expect(() => throwIfArtifactIntelligenceFailed("artifact-1", {
      status: "completed",
    })).not.toThrow();
  });
});

describe("processArtifact document indexing", () => {
  it("fails document artifacts when the embedding runtime is not configured", async () => {
    const repository = createArtifactRepositoryStub();

    await expect(processArtifact(repository, "artifact-1", {
      privateFragmentStorage: {
        async storePrivateFragment() {
          return {
            contentStorageRef: "walrus://blob/document",
            contentSha256: "sha",
            metadata: {},
          };
        },
      },
    })).rejects.toThrow("document_embedding_required:text_embedder_not_configured");
  });
});

describe("processCandidateMemoryArchive", () => {
  it("records insufficient storage balance as a non-retryable archive failure", async () => {
    const repository = createArtifactRepositoryStub();
    const archiveFailures: Array<{ candidateMemoryIds: string[]; metadata: Record<string, unknown> }> = [];
    const artifactCompletions: Array<Record<string, unknown>> = [];
    const auditEvents: Array<{ eventType: string; metadata: Record<string, unknown> }> = [];
    repository.markCandidateMemoriesArchiveFailed = async (input) => {
      archiveFailures.push(input);
    };
    repository.findArtifactById = async () => ({
      id: "artifact-1",
      twinId: "twin-1",
      sourceType: "pdf",
      rawStorageRef: "walrus://blob/source",
      metadata: { processing: { documentIndex: { status: "completed" } } },
    });
    repository.markArtifactCompleted = async (_id, metadata) => {
      artifactCompletions.push(metadata);
    };
    repository.createAuditEvent = async (input) => {
      auditEvents.push({ eventType: input.eventType, metadata: input.metadata });
    };

    const result = await processCandidateMemoryArchive(repository, {
      archiveId: "archive-1",
      artifactId: "artifact-1",
      twinId: "twin-1",
      memoryFragmentId: "fragment-1",
      sourceType: "candidate_memory_batch",
      candidateMemoryIds: ["candidate-1"],
      encryptedBytesBase64: "AA==",
      contentSha256: "sha",
      metadata: {},
      privateFragmentStorage: {
        async storeEncryptedPrivateFragment() {
          throw new WalrusStorageError({
            code: "walrus_insufficient_balance",
            message: "Walrus storage wallet has insufficient SUI for this write",
            cause: new Error("insufficient balance"),
            storageWallet: {
              network: "testnet",
              address: "0xwallet",
              coinType: "0x2::sui::SUI",
              balanceMist: "0",
              balanceSui: "0",
              requiredMist: "1000000",
              requiredSui: "0.001",
              shortfallMist: "1000000",
              shortfallSui: "0.001",
              requiredAmountSource: "configured_minimum",
            },
          });
        },
      },
    });

    expect(result).toMatchObject({
      status: "failed",
      reason: "storage_wallet_insufficient_balance",
      retryable: false,
    });
    expect(archiveFailures[0]).toMatchObject({
      archiveId: "archive-1",
      candidateMemoryIds: ["candidate-1"],
      metadata: {
        archiveStatus: "failed",
        archiveReason: "storage_wallet_insufficient_balance",
        archiveErrorCode: "walrus_insufficient_balance",
        archiveRetryable: false,
      },
    });
    expect(artifactCompletions[0]).toMatchObject({
      processing: {
        documentIndex: { status: "completed" },
        candidateMemoryArchive: {
          status: "failed",
          reason: "storage_wallet_insufficient_balance",
          errorCode: "walrus_insufficient_balance",
          retryable: false,
        },
      },
    });
    expect(auditEvents[0]).toMatchObject({
      eventType: "artifact.candidate_memories_archive_failed",
      metadata: {
        reason: "storage_wallet_insufficient_balance",
        retryable: false,
      },
    });
  });
});

describe("enqueueDueCandidateMemoryArchives", () => {
  it("requeues due archive batches from durable storage", async () => {
    const repository = createArtifactRepositoryStub();
    const queuedArchives: Array<{ archiveId?: string; candidateMemoryIds: string[] }> = [];
    const markedQueued: Array<{ archiveId: string; candidateMemoryIds: string[]; jobId: string }> = [];

    repository.findDueCandidateMemoryArchives = async () => [
      {
        id: "archive-1",
        twinId: "twin-1",
        sourceArtifactId: "artifact-1",
        memoryFragmentId: "fragment-1",
        sourceType: "candidate_memory_batch",
        candidateMemoryIds: ["candidate-1"],
        encryptedBytesBase64: "AA==",
        contentSha256: "sha",
        metadata: {},
      },
    ];
    repository.markCandidateMemoryArchiveQueued = async (input) => {
      markedQueued.push(input);
    };

    const result = await enqueueDueCandidateMemoryArchives(repository, {
      candidateMemoryArchiveQueue: {
        async enqueueCandidateMemoryArchive(input) {
          queuedArchives.push({
            archiveId: input.archiveId,
            candidateMemoryIds: input.candidateMemoryIds,
          });
          return { jobId: "job-1" };
        },
      },
    });

    expect(result).toEqual({ scanned: 1, queued: 1, failed: 0 });
    expect(queuedArchives).toEqual([{ archiveId: "archive-1", candidateMemoryIds: ["candidate-1"] }]);
    expect(markedQueued).toEqual([{ archiveId: "archive-1", candidateMemoryIds: ["candidate-1"], jobId: "job-1" }]);
  });
});

function createArtifactRepositoryStub(): ArtifactRepository {
  return {
    async findArtifactById() {
      return null;
    },
    async findQueuedArtifacts() {
      return [];
    },
    async claimArtifact() {
      return {
        id: "artifact-1",
        twinId: "twin-1",
        sourceType: "upload",
        rawStorageRef: null,
        metadata: {
          processingInput: {
            content: "A document fact worth embedding.",
          },
        },
      };
    },
    async claimRecoverableArtifact() {
      return null;
    },
    async markArtifactProcessing() {},
    async markArtifactPending() {},
    async markArtifactCompleted() {},
    async markArtifactFailed() {},
    async findMemoryFragmentBySourceArtifactId() {
      return null;
    },
    async findMemoryFragmentById() {
      return null;
    },
    async findTwinIdentityProfile() {
      return null;
    },
    async findSourceSpeakerMappings() {
      return [];
    },
    async findRecentPatternSignals() {
      return [];
    },
    async createMemoryFragment() {
      return { id: "fragment-1" };
    },
    async replaceDocumentChunks() {
      return { count: 0 };
    },
    async replaceDocumentPages() {
      return { count: 0 };
    },
    async upsertGraphNode() {
      return { id: "node-1" };
    },
    async upsertGraphEdge() {
      return { id: "edge-1" };
    },
    async createCandidateMemory() {
      return { id: "candidate-1" };
    },
    async createCandidateMemoryArchive() {
      return { id: "archive-1" };
    },
    async markCandidateMemoryArchiveQueued() {},
    async markCandidateMemoryArchiveArchiving() {},
    async markCandidateMemoriesArchived() {},
    async markCandidateMemoriesArchiveFailed() {},
    async findCandidateMemoryArchiveById() {
      return null;
    },
    async findDueCandidateMemoryArchives() {
      return [];
    },
    async updateCandidateMemoryStatus() {},
    async findCanonicalMemoryCandidates() {
      return [];
    },
    async createCanonicalMemory() {
      return { id: "canonical-1" };
    },
    async updateCanonicalMemory() {},
    async createAuditEvent() {},
  };
}
