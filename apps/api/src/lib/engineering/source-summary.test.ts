import { describe, expect, it } from "vitest";
import { toEngineeringSourceSummary } from "./source-summary.js";

describe("engineering source summary helpers", () => {
  it("summarizes engineering source artifacts", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    expect(toEngineeringSourceSummary({
      id: "artifact-1",
      sourceType: "markdown",
      ingestionStatus: "complete",
      rawStorageRef: "walrus://blob/id",
      metadata: { fileName: "README.md", engineering: true },
      createdAt: now,
      updatedAt: now,
    } as never, [{
      id: "candidate-1",
      memoryType: "fact",
      status: "pending",
      metadata: {
        engineeringMemoryType: "architecture",
        engineeringInstructionScope: "project",
        subject: "Use pnpm",
      },
      confidenceScore: 0.8,
      evidenceHash: "hash",
      evidenceLength: 10,
      statementStorageRef: "ref",
      createdAt: now,
    } as never])).toMatchObject({
      artifactId: "artifact-1",
      sourceFile: "README.md",
      extractedEngineeringMemoryCount: 1,
      counts: {
        byType: { architecture: 1 },
        byStatus: { pending: 1 },
        byScope: { project: 1 },
      },
    });
  });
});
