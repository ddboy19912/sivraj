import { describe, expect, it, vi } from "vitest";
import {
  applyConversationReviewAction,
  buildApprovedVoiceMemoryMetadata,
  buildApprovedArtifactInsertMetadata,
  buildConversationReviewResult,
  conversationReviewFeedbackType,
  conversationReviewNotFoundResult,
  createApprovedConversationMemoryArtifact,
  enqueueApprovedArtifactProcessing,
  isVoiceConversationCandidate,
  readApprovedArtifactStorageFailure,
  readEditedApprovalStorageError,
  resolveConversationReviewCounters,
  shouldCreateEditedApprovalArtifact,
  storeApprovedConversationMemory,
} from "./review.js";

describe("conversation review helpers", () => {
  it("maps review actions to feedback types", () => {
    expect(conversationReviewFeedbackType("approve")).toBe("approved");
    expect(conversationReviewFeedbackType("reject")).toBe("rejected");
  });

  it("builds approved voice memory metadata", () => {
    expect(buildApprovedVoiceMemoryMetadata({
      sourceArtifactId: "artifact-1",
      candidate: {
        id: "candidate-1",
        memoryType: "preference",
        metadata: { subject: "Use pnpm" },
      },
      statement: "Prefer pnpm for installs",
    })).toMatchObject({
      statement: "Prefer pnpm for installs",
      metadata: {
        sourceArtifactId: "artifact-1",
        sourceCandidateMemoryId: "candidate-1",
        subject: "Use pnpm",
        reviewApproved: true,
      },
    });
  });

  it("detects voice conversation candidates", () => {
    expect(isVoiceConversationCandidate({ voiceDerived: true })).toBe(true);
    expect(isVoiceConversationCandidate({
      conversationUnderstanding: { sourceType: "voice_conversation" },
    })).toBe(true);
    expect(isVoiceConversationCandidate({})).toBe(false);
  });

  it("detects edited approval flows", () => {
    expect(shouldCreateEditedApprovalArtifact({
      action: "approve",
      editedStatement: "Updated",
    })).toBe(true);
    expect(conversationReviewNotFoundResult("missing")).toEqual({
      result: { candidateId: "missing", status: "not_found" },
    });
    expect(buildApprovedArtifactInsertMetadata({
      sourceArtifactId: "artifact-1",
      sourceCandidateMemoryId: "candidate-1",
      stored: { ciphertextSha256: "abc", seal: {}, walrus: {} },
    })).toMatchObject({ sourceArtifactId: "artifact-1" });
  });

  it("reads edited approval storage errors", () => {
    expect(readEditedApprovalStorageError(null)).toEqual({
      status: 503,
      body: { error: "encrypted_storage_not_configured" },
    });
    expect(readEditedApprovalStorageError({ storePrivateMemory: vi.fn() })).toBeNull();
    expect(readApprovedArtifactStorageFailure(null)).toEqual({
      status: 503,
      body: { error: "encrypted_storage_failed" },
    });
  });

  it("stores approved conversation memories", async () => {
    const storePrivateMemory = vi.fn().mockResolvedValue({ rawStorageRef: "ref-1" });
    const stored = await storeApprovedConversationMemory({
      privateMemoryStorage: { storePrivateMemory } as never,
      twinId: "twin-1",
      approvedMetadata: buildApprovedVoiceMemoryMetadata({
        sourceArtifactId: "artifact-1",
        candidate: { id: "candidate-1", memoryType: "preference", metadata: {} },
        statement: "Prefer pnpm",
      }),
    });

    expect(stored).toEqual({ rawStorageRef: "ref-1" });
  });

  it("creates approved conversation memory artifacts", async () => {
    let insertCount = 0;
    const artifact = await createApprovedConversationMemoryArtifact({
      db: {
        insert: () => ({
          values: () => ({
            returning: async () => {
              insertCount += 1;
              return insertCount === 1 ? [{ id: "artifact-2" }] : [];
            },
          }),
        }),
      } as never,
      privateMemoryStorage: {
        storePrivateMemory: vi.fn().mockResolvedValue({
          rawStorageRef: "ref-1",
          ciphertextSha256: "abc",
          seal: {},
          walrus: {},
        }),
      },
      artifactProcessingQueue: null,
      twinId: "twin-1",
      sourceArtifactId: "artifact-1",
      candidate: {
        id: "candidate-1",
        memoryType: "preference",
        metadata: {},
      } as never,
      statement: "Prefer pnpm",
    });

    expect(artifact).toEqual({ artifactId: "artifact-2", processingJobId: null });
    expect(insertCount).toBe(1);
  });

  it("enqueues approved artifact processing jobs", async () => {
    const enqueueArtifactProcessing = vi.fn().mockResolvedValue({ jobId: "job-1" });
    const queued = await enqueueApprovedArtifactProcessing({
      artifactProcessingQueue: { enqueueArtifactProcessing } as never,
      artifact: { id: "artifact-2" },
      twinId: "twin-1",
    });

    expect(queued).toEqual({ jobId: "job-1" });
  });

  it("applies conversation review actions", async () => {
    const updated = await applyConversationReviewAction({
      db: {
        update: () => ({
          set: () => ({
            where: () => ({
              returning: async () => [{ status: "rejected" }],
            }),
          }),
        }),
        insert: () => ({
          values: async () => undefined,
        }),
      } as never,
      privateMemoryStorage: null,
      artifactProcessingQueue: null,
      gate: {
        twinId: "twin-1",
        auth: { type: "user", sub: "user-1" },
        artifact: { id: "artifact-1" },
      },
      action: {
        candidateId: "candidate-1",
        action: "reject",
      },
      candidate: {
        id: "candidate-1",
        memoryType: "preference",
        metadata: {},
      } as never,
    });

    expect(updated).toMatchObject({
      rejected: true,
      result: {
        candidateId: "candidate-1",
        action: "reject",
        status: "rejected",
      },
    });
  });

  it("builds review results and counters", () => {
    expect(buildConversationReviewResult({
      candidateId: "candidate-1",
      action: "approve",
      status: "approved",
      approvedArtifactId: "artifact-2",
    })).toEqual({
      candidateId: "candidate-1",
      action: "approve",
      status: "approved",
      approvedArtifactId: "artifact-2",
      processingJobId: null,
    });

    expect(resolveConversationReviewCounters({
      action: "approve",
      editedArtifactCreated: true,
    })).toEqual({
      approvedCount: 1,
      rejectedCount: 0,
      editedArtifactCount: 1,
    });
  });
});
