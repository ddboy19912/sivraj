import { describe, expect, it } from "vitest";
import {
  detectEngineeringInstructionIssues,
  type EngineeringInstructionRecord,
} from "./index.js";

const baseInstruction: EngineeringInstructionRecord = {
  id: "candidate",
  statement: "Use pnpm for package management.",
  engineeringMemoryType: "tool_preference",
  scope: "project",
  subject: "package manager",
  confidence: 0.8,
};

describe("detectEngineeringInstructionIssues", () => {
  it("detects package manager conflicts", () => {
    const issues = detectEngineeringInstructionIssues({
      candidate: baseInstruction,
      existingInstructions: [
        {
          ...baseInstruction,
          id: "existing",
          statement: "Use npm for package management.",
        },
      ],
    });

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      issueType: "conflict",
      reason: "package_manager_conflict",
      severity: "medium",
      candidateId: "candidate",
      existingId: "existing",
      metadata: {
        candidateChoice: "pnpm",
        existingChoice: "npm",
      },
    });
    expect(issues[0]?.evidence.candidateStatementHash).toMatch(/^[a-f0-9]{8}$/);
  });

  it("detects frontend framework conflicts", () => {
    const issues = detectEngineeringInstructionIssues({
      candidate: {
        ...baseInstruction,
        statement: "Use Vite React for standalone frontend apps.",
        engineeringMemoryType: "coding_preference",
        subject: "frontend framework",
      },
      existingInstructions: [
        {
          ...baseInstruction,
          id: "existing",
          statement: "Use Next.js for frontend apps.",
          engineeringMemoryType: "coding_preference",
          subject: "frontend framework",
        },
      ],
    });

    expect(issues).toMatchObject([
      {
        issueType: "conflict",
        reason: "frontend_framework_conflict",
      },
    ]);
  });

  it("detects runtime version conflicts", () => {
    const issues = detectEngineeringInstructionIssues({
      candidate: {
        ...baseInstruction,
        statement: "Use Node 24 for local development.",
        subject: "node",
      },
      existingInstructions: [
        {
          ...baseInstruction,
          id: "existing",
          statement: "Use Node 18 for local development.",
          subject: "node",
        },
      ],
    });

    expect(issues).toMatchObject([
      {
        reason: "runtime_version_conflict",
        metadata: {
          runtime: "node",
          candidateVersion: "24",
          existingVersion: "18",
        },
      },
    ]);
  });

  it("detects direct use/avoid contradictions", () => {
    const issues = detectEngineeringInstructionIssues({
      candidate: {
        ...baseInstruction,
        statement: "Avoid bun for this repo.",
        subject: "bun",
      },
      existingInstructions: [
        {
          ...baseInstruction,
          id: "existing",
          statement: "Use bun for this repo.",
          subject: "bun",
        },
      ],
    });

    expect(issues).toMatchObject([
      {
        reason: "direct_use_avoid_conflict",
        severity: "high",
        metadata: {
          tool: "bun",
          candidateIntent: "avoid",
          existingIntent: "use",
        },
      },
    ]);
  });

  it("marks expired temporary instructions as stale", () => {
    const issues = detectEngineeringInstructionIssues({
      now: new Date("2026-05-24T00:00:00.000Z"),
      temporaryTtlDays: 30,
      candidate: {
        ...baseInstruction,
        statement: "For this launch week, prioritize speed over polish.",
        scope: "temporary",
        createdAt: "2026-04-01T00:00:00.000Z",
      },
      existingInstructions: [],
    });

    expect(issues).toMatchObject([
      {
        issueType: "stale",
        reason: "temporary_instruction_expired",
        severity: "medium",
        metadata: {
          ageDays: 53,
          temporaryTtlDays: 30,
        },
      },
    ]);
  });

  it("marks valid-until expired instructions as stale", () => {
    const issues = detectEngineeringInstructionIssues({
      now: new Date("2026-05-24T00:00:00.000Z"),
      candidate: {
        ...baseInstruction,
        metadata: {
          validUntil: "2026-05-01T00:00:00.000Z",
        },
      },
      existingInstructions: [],
    });

    expect(issues).toMatchObject([
      {
        issueType: "stale",
        reason: "valid_until_expired",
        severity: "high",
      },
    ]);
  });

  it("does not compare unrelated project-scoped rules across projects", () => {
    const issues = detectEngineeringInstructionIssues({
      candidate: {
        ...baseInstruction,
        scope: "project",
        statement: "Use pnpm in this repo.",
      },
      existingInstructions: [
        {
          ...baseInstruction,
          id: "existing",
          scope: "agent_specific",
          statement: "Use npm in Claude Code instructions.",
        },
      ],
    });

    expect(issues).toEqual([]);
  });
});
