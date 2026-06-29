import { describe, expect, it } from "vitest";
import {
  extractTelegramCapturedText,
  formatTelegramAnswerText,
  isNonTerminalTelegramAnswer,
  shouldUseFreshTelegramCapture,
} from "./ask.js";

describe("Telegram ask helpers", () => {
  it("formats empty answers with a safe fallback", () => {
    expect(formatTelegramAnswerText("  ")).toBe("I do not have an answer yet.");
  });

  it("replaces non-terminal Telegram answers with a truthful final reply", () => {
    expect(isNonTerminalTelegramAnswer(
      'I can summarize the "Sivraj_Demo_Launch_Notes.pdf" for you. Please give me a moment to process it.',
    )).toBe(true);
    expect(formatTelegramAnswerText(
      'I can summarize the "Sivraj_Demo_Launch_Notes.pdf" for you. Please give me a moment to process it.',
    )).toBe("I couldn’t complete that answer in this Telegram turn. Please ask again and I’ll answer directly, or tell you if the source is unreadable.");
    expect(isNonTerminalTelegramAnswer("The PDF recommends positioning Sivraj as a sovereign AI Twin.")).toBe(false);
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
