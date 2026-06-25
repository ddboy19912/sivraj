import { describe, expect, it } from "vitest";
import {
  candidateMemoryArchiveJobId,
  contextWarmupJobId,
  safeBullMqJobId,
  safeBullMqJobIdPart,
} from "./index";

describe("BullMQ job id helpers", () => {
  it("sanitizes individual job id parts", () => {
    expect(safeBullMqJobIdPart("scope:with/slashes and spaces")).toBe(
      "scope-with-slashes-and-spaces",
    );
  });

  it("joins sanitized job id parts without BullMQ-reserved colons", () => {
    expect(safeBullMqJobId("twin:1", "voice_chat", "scope/default")).toBe(
      "twin-1-voice_chat-scope-default",
    );
  });

  it("builds context warmup job ids without colons", () => {
    const jobId = contextWarmupJobId({
      twinId: "00000000-0000-4000-8000-000000000001",
      requestedBy: "user-1",
      surface: "voice_chat",
      reason: "voice_start",
      scope: "morning:session/default",
      documentIds: ["doc:1", "folder/doc 2"],
    });

    expect(jobId).toBe(
      "00000000-0000-4000-8000-000000000001-voice_chat-voice_start-morning-session-default-doc-1-folder-doc-2",
    );
    expect(jobId).not.toContain(":");
  });

  it("builds candidate memory archive fallback job ids without colons", () => {
    const jobId = candidateMemoryArchiveJobId({
      artifactId: "artifact:abc/123",
      contentSha256: "abcdef0123456789abcdef",
    });

    expect(jobId).toBe("artifact-abc-123-candidate-memory-archive-abcdef0123456789");
    expect(jobId).not.toContain(":");
  });
});
