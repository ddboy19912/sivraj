import { describe, expect, it } from "vitest";
import {
  buildWritebackPayload,
  readCountRecord,
  readPrOrCommitImportPayload,
  toAgentWritebackSummary,
  validateWritebackCreateInput,
} from "./input.js";

describe("agent writeback input helpers", () => {
  it("validates writeback create input", () => {
    expect(validateWritebackCreateInput({
      taskSummary: "Implemented auth",
      agentName: "cursor",
      repo: "org/repo",
    })).toMatchObject({
      ok: true,
      value: {
        agentName: "cursor",
        writebackPayload: {
          taskSummary: "Implemented auth",
        },
      },
    });
  });

  it("rejects missing task summaries for plaintext writebacks", () => {
    expect(validateWritebackCreateInput({})).toMatchObject({
      ok: false,
      error: { body: { error: "missing_task_summary" } },
    });
  });

  it("reads pr import payloads", () => {
    expect(readPrOrCommitImportPayload({
      title: "Add auth",
      summary: "Adds wallet auth",
      repo: "org/repo",
      number: "42",
    }, "pull_request")).toMatchObject({
      ok: true,
      value: {
        title: "Add auth",
        identifier: "42",
      },
    });
  });

  it("builds writeback payload counts from arrays", () => {
    const validated = validateWritebackCreateInput({
      taskSummary: "Done",
      filesTouched: ["a.ts"],
      commandsRun: ["pnpm test"],
    });

    if (!validated.ok) {
      throw new Error("expected valid writeback input");
    }

    expect(buildWritebackPayload(validated.value, {
      rawStorageRef: "walrus://blob/id",
      ciphertextSha256: "abc",
      seal: {},
      walrus: {},
    })).toMatchObject({
      counts: {
        filesTouched: 1,
        commandsRun: 1,
      },
    });
  });

  it("summarizes stored writebacks", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    expect(toAgentWritebackSummary({
      id: "wb-1",
      twinId: "twin-1",
      clientId: "client-1",
      status: "pending",
      payload: {
        agentName: "cursor",
        repo: "org/repo",
        storage: { rawStorageRef: "walrus://blob/id" },
        counts: { filesTouched: 2 },
      },
      createdAt: now,
      updatedAt: now,
      approvedAt: null,
      rejectedAt: null,
    } as never)).toMatchObject({
      id: "wb-1",
      agentName: "cursor",
      rawStorageRef: "walrus://blob/id",
      counts: { filesTouched: 2 },
    });
  });

  it("reads count records with defaults", () => {
    expect(readCountRecord({ filesTouched: 3 })).toEqual({
      filesTouched: 3,
      commandsRun: 0,
      testsRun: 0,
      decisions: 0,
      bugsFound: 0,
      followUps: 0,
      userCorrections: 0,
    });
  });
});
