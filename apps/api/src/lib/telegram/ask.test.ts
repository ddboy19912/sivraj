import { describe, expect, it } from "vitest";
import {
  buildTelegramAskContextResolution,
  extractTelegramCapturedText,
  formatTelegramAnswerText,
  shouldUseFreshTelegramCapture,
} from "./ask.js";

describe("Telegram ask helpers", () => {
  it("forces ask commands into memory retrieval planning", () => {
    expect(buildTelegramAskContextResolution("What do I prefer for investor calls?")).toMatchObject({
      intent: "memory_qa",
      answerTarget: "memory",
      retrieval: "hot_memory",
      memoryWrite: "skip",
      memoryRequest: {
        kind: "specific_fact",
        scope: "preferences",
      },
    });
    expect(buildTelegramAskContextResolution("What is my occupation?")).toMatchObject({
      memoryRequest: {
        kind: "specific_fact",
        scope: "profile",
        searchTerms: ["occupation", "profession", "job", "career", "role"],
      },
    });
  });

  it("formats empty answers with a safe fallback", () => {
    expect(formatTelegramAnswerText("  ")).toBe("I do not have an answer yet.");
  });

  it("extracts the user text from encrypted Telegram capture payload content", () => {
    expect(extractTelegramCapturedText([
      "Telegram message",
      "From: Fortune (@f_ogunsusi)",
      "Message id: 12",
      "",
      "Remember that I prefer morning investor calls on Tuesdays.",
    ].join("\n"))).toBe("Remember that I prefer morning investor calls on Tuesdays.");
  });

  it("excludes captured-only Telegram messages from fresh ask context", () => {
    expect(shouldUseFreshTelegramCapture({
      metadata: {
        hotMemory: {
          status: "captured_only",
          retrievable: false,
        },
      },
    })).toBe(false);
    expect(shouldUseFreshTelegramCapture({
      metadata: {
        hotMemory: {
          status: "committed",
          retrievable: true,
        },
      },
    })).toBe(true);
    expect(shouldUseFreshTelegramCapture({ metadata: null })).toBe(true);
  });

  it("truncates long answers for Telegram replies", () => {
    const formatted = formatTelegramAnswerText("a".repeat(5000));

    expect(formatted.length).toBeLessThanOrEqual(3900);
    expect(formatted.endsWith("[truncated]")).toBe(true);
  });
});
