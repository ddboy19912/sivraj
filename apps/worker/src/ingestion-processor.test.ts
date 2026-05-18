import { describe, expect, it } from "vitest";
import {
  ENCRYPTED_DECRYPTION_REQUIRED,
  MISSING_PROCESSABLE_CONTENT,
  processQueuedArtifacts,
  type ArtifactRepository,
  type QueuedArtifact,
} from "./ingestion-processor.js";

describe("processQueuedArtifacts", () => {
  it("moves encrypted private artifacts to pending without creating plaintext fragments", async () => {
    const repository = createRepository([
      {
        id: "artifact-id",
        twinId: "twin-id",
        sourceType: "note",
        title: "Private note",
        rawStorageRef: "walrus://blob/blob-id",
        metadata: {
          storageMode: "encrypted_walrus",
          sensitivity: "private",
        },
      },
    ]);

    const result = await processQueuedArtifacts(repository, {
      now: new Date("2026-05-18T00:00:00.000Z"),
    });

    expect(result).toEqual({ scanned: 1, completed: 0, pending: 1, failed: 0 });
    expect(repository.fragments).toEqual([]);
    expect(repository.artifacts[0]?.status).toBe("pending");
    expect(repository.artifacts[0]?.metadata).toMatchObject({
      processing: {
        status: "pending",
        reason: ENCRYPTED_DECRYPTION_REQUIRED,
      },
    });
    expect(repository.auditEvents[0]).toMatchObject({
      eventType: "artifact.processing_pending",
      resourceId: "artifact-id",
      metadata: {
        reason: ENCRYPTED_DECRYPTION_REQUIRED,
        rawStorageRef: "walrus://blob/blob-id",
      },
    });
  });

  it("creates a memory fragment for explicit non-private processing input", async () => {
    const repository = createRepository([
      {
        id: "artifact-id",
        twinId: "twin-id",
        sourceType: "upload",
        title: "Public import",
        rawStorageRef: null,
        metadata: {
          sensitivity: "public",
          processingInput: {
            content: "Plain public memory.",
          },
        },
      },
    ]);

    const result = await processQueuedArtifacts(repository);

    expect(result).toEqual({ scanned: 1, completed: 1, pending: 0, failed: 0 });
    expect(repository.fragments[0]).toMatchObject({
      twinId: "twin-id",
      sourceArtifactId: "artifact-id",
      content: "Plain public memory.",
      summary: "Public import",
    });
    expect(repository.artifacts[0]?.status).toBe("completed");
    expect(repository.auditEvents[0]).toMatchObject({
      eventType: "artifact.processed",
      resourceId: "artifact-id",
    });
  });

  it("decrypts encrypted private artifacts when a scoped reader is available", async () => {
    const repository = createRepository([
      {
        id: "artifact-id",
        twinId: "twin-id",
        sourceType: "note",
        title: "Private note",
        rawStorageRef: "walrus://blob/blob-id",
        metadata: {
          storageMode: "encrypted_walrus",
          sensitivity: "private",
        },
      },
    ]);
    const readerCalls: unknown[] = [];

    const result = await processQueuedArtifacts(repository, {
      privateMemoryReader: {
        async readPrivateMemory(input) {
          readerCalls.push(input);
          return "Decrypted private memory.";
        },
      },
    });

    expect(result).toEqual({ scanned: 1, completed: 1, pending: 0, failed: 0 });
    expect(readerCalls).toEqual([
      {
        rawStorageRef: "walrus://blob/blob-id",
        artifactId: "artifact-id",
        twinId: "twin-id",
      },
    ]);
    expect(repository.fragments[0]).toMatchObject({
      twinId: "twin-id",
      sourceArtifactId: "artifact-id",
      content: "Decrypted private memory.",
      summary: "Private note",
    });
    expect(repository.artifacts[0]?.status).toBe("completed");
    expect(repository.artifacts[0]?.metadata).toMatchObject({
      processing: {
        status: "completed",
        decryptPath: "seal_walrus",
      },
    });
    expect(repository.auditEvents[0]).toMatchObject({
      eventType: "artifact.processed",
      resourceId: "artifact-id",
      metadata: {
        decryptPath: "seal_walrus",
        rawStorageRef: "walrus://blob/blob-id",
      },
    });
  });

  it("does not create duplicate fragments when a processing artifact is retried", async () => {
    const repository = createRepository([
      {
        id: "artifact-id",
        twinId: "twin-id",
        sourceType: "pdf",
        title: "Private PDF",
        rawStorageRef: "walrus://blob/blob-id",
        metadata: {
          storageMode: "encrypted_walrus",
          sensitivity: "private",
        },
      },
    ]);

    repository.fragments.push({
      id: "existing-fragment",
      sourceArtifactId: "artifact-id",
    });

    const result = await processQueuedArtifacts(repository, {
      privateMemoryReader: {
        async readPrivateMemory() {
          return "Decrypted private memory.";
        },
      },
    });

    expect(result).toEqual({ scanned: 1, completed: 1, pending: 0, failed: 0 });
    expect(repository.fragments).toHaveLength(1);
    expect(repository.artifacts[0]?.metadata).toMatchObject({
      processing: {
        status: "completed",
        memoryFragmentId: "existing-fragment",
      },
    });
  });

  it("fails non-encrypted artifacts that have no processing input", async () => {
    const repository = createRepository([
      {
        id: "artifact-id",
        twinId: "twin-id",
        sourceType: "upload",
        title: null,
        rawStorageRef: null,
        metadata: {},
      },
    ]);

    const result = await processQueuedArtifacts(repository);

    expect(result).toEqual({ scanned: 1, completed: 0, pending: 0, failed: 1 });
    expect(repository.artifacts[0]?.status).toBe("failed");
    expect(repository.artifacts[0]?.metadata).toMatchObject({
      processing: {
        status: "failed",
        reason: MISSING_PROCESSABLE_CONTENT,
      },
    });
  });
});

function createRepository(artifacts: QueuedArtifact[]) {
  const state = artifacts.map((artifact) => ({
    ...artifact,
    status: "queued",
  }));
  const fragments: unknown[] = [];
  const auditEvents: unknown[] = [];

  const repository: ArtifactRepository & {
    artifacts: typeof state;
    fragments: unknown[];
    auditEvents: unknown[];
  } = {
    artifacts: state,
    fragments,
    auditEvents,
    async findQueuedArtifacts(limit) {
      return state.filter((artifact) => artifact.status === "queued").slice(0, limit);
    },
    async claimArtifact(id) {
      const artifact = state.find((candidate) => candidate.id === id && candidate.status === "queued");

      if (!artifact) {
        return null;
      }

      artifact.status = "processing";
      return artifact;
    },
    async claimRecoverableArtifact(id) {
      const artifact = state.find((candidate) => candidate.id === id && candidate.status === "queued");

      if (!artifact) {
        return null;
      }

      artifact.status = "processing";
      return artifact;
    },
    async markArtifactPending(id, metadata) {
      updateArtifact(state, id, "pending", metadata);
    },
    async markArtifactCompleted(id, metadata) {
      updateArtifact(state, id, "completed", metadata);
    },
    async markArtifactFailed(id, metadata) {
      updateArtifact(state, id, "failed", metadata);
    },
    async findMemoryFragmentBySourceArtifactId(sourceArtifactId) {
      return (
        fragments.find(
          (fragment) =>
            typeof fragment === "object" &&
            fragment !== null &&
            "sourceArtifactId" in fragment &&
            fragment.sourceArtifactId === sourceArtifactId,
        ) as { id: string } | undefined
      ) ?? null;
    },
    async createMemoryFragment(input) {
      const fragment = { ...input, id: `fragment-${fragments.length + 1}` };
      fragments.push(fragment);
      return fragment;
    },
    async createAuditEvent(input) {
      auditEvents.push(input);
    },
  };

  return repository;
}

function updateArtifact(
  artifacts: Array<QueuedArtifact & { status: string }>,
  id: string,
  status: string,
  metadata: Record<string, unknown>,
) {
  const artifact = artifacts.find((candidate) => candidate.id === id);

  if (!artifact) {
    throw new Error(`Missing artifact ${id}`);
  }

  artifact.status = status;
  artifact.metadata = metadata;
}
