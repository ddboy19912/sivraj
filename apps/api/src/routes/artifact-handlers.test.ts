import { describe, expect, it } from "vitest";
import {
  buildArtifactContentResponse,
  formatArtifactSourceSummary,
  isRetryableFileSourceType,
} from "./artifact-handlers.js";

describe("artifact source response helpers", () => {
  it("summarizes agent instruction artifacts with exact content availability", () => {
    const artifact = sourceArtifactRow({
      metadata: {
        engineeringSourceKind: "agent_instruction_file",
        targetInstructionFile: "AGENTS.md",
        agentInstructionFileName: "AGENTS.md",
        sourceDisplayName: "project-agent-rules.md",
      },
      rawStorageRef: "walrus://source/1",
    });

    expect(formatArtifactSourceSummary(artifact, [
      { id: "candidate-1", metadata: { engineering: true } },
      { id: "candidate-2", metadata: { memoryType: "fact" } },
    ])).toMatchObject({
      artifactId: "artifact-1",
      sourceType: "markdown",
      sourceKind: "agent_instruction_file",
      displayName: "project-agent-rules.md",
      targetInstructionFile: "AGENTS.md",
      exactContentAvailable: true,
      candidateMemoryCount: 2,
      engineeringMemoryCount: 1,
      metadata: {
        engineeringSourceKind: "agent_instruction_file",
        targetInstructionFile: "AGENTS.md",
        sourceDisplayName: "project-agent-rules.md",
      },
    });
  });

  it("returns decrypted source content without summarizing it", () => {
    const exactContent = "# AGENTS.md\n\n- Preserve this exact instruction.";
    const response = buildArtifactContentResponse(sourceArtifactRow({
      metadata: {
        engineeringSourceKind: "agent_instruction_file",
        targetInstructionFile: "AGENTS.md",
      },
    }), {
      title: "AGENTS.md",
      content: exactContent,
      metadata: {
        fileName: "AGENTS.md",
        engineeringSourceKind: "agent_instruction_file",
        targetInstructionFile: "AGENTS.md",
      },
    });

    expect(response.policy).toMatchObject({
      rawArtifactsIncluded: true,
      decryptedSourceIncluded: true,
      scope: "memory:read",
    });
    expect(response.artifact).toMatchObject({
      fileName: "AGENTS.md",
      contentType: "text/markdown; charset=utf-8",
      encoding: "text",
      metadata: {
        engineeringSourceKind: "agent_instruction_file",
        targetInstructionFile: "AGENTS.md",
      },
    });
    expect(response.content).toBe(exactContent);
  });
});

describe("artifact retry helpers", () => {
  it("limits bulk failed retries to uploaded file/source artifacts", () => {
    expect(isRetryableFileSourceType("upload")).toBe(true);
    expect(isRetryableFileSourceType("pdf")).toBe(true);
    expect(isRetryableFileSourceType("ocr_pdf")).toBe(true);
    expect(isRetryableFileSourceType("markdown")).toBe(true);
    expect(isRetryableFileSourceType("docx")).toBe(true);
    expect(isRetryableFileSourceType("csv")).toBe(true);
    expect(isRetryableFileSourceType("image")).toBe(true);
    expect(isRetryableFileSourceType("identity_profile")).toBe(false);
    expect(isRetryableFileSourceType("onboarding")).toBe(false);
    expect(isRetryableFileSourceType("chat_export")).toBe(false);
    expect(isRetryableFileSourceType("voice_transcript")).toBe(false);
  });
});

function sourceArtifactRow(overrides: Record<string, unknown> = {}) {
  const now = new Date("2026-06-21T10:00:00.000Z");

  return {
    id: "artifact-1",
    twinId: "twin-1",
    sourceType: "markdown",
    ingestionStatus: "completed",
    rawStorageRef: "walrus://source/default",
    hash: null,
    metadata: {},
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as never;
}
