import { describe, expect, it } from "vitest";
import type { MemoryIntakeResult } from "../chat/memory-intake.js";
import {
  resolveTelegramTextCaptureDisposition,
  telegramHotMemoryCommitMetadata,
  telegramTextCaptureReply,
  telegramTextMemoryIntent,
  type TelegramHotMemoryCommitResult,
} from "./memory-capture.js";

describe("Telegram memory capture helpers", () => {
  it("treats explicit remember text as remember-mode intake", () => {
    expect(telegramTextMemoryIntent("Remember that I prefer morning investor calls on Tuesdays.")).toBe("remember");
    expect(telegramTextMemoryIntent("please save this note: launch calls happen at 9")).toBe("remember");
    expect(telegramTextMemoryIntent("Do not remember this throwaway line")).toBe("auto");
    expect(telegramTextMemoryIntent("The launch call is at 9.")).toBe("auto");
  });

  it("ignores low-signal chat instead of sending it to memory capture", () => {
    expect(resolveTelegramTextCaptureDisposition("hello")).toEqual({
      action: "ignore",
      reason: "low_signal",
      replyText: "Hi. Send something you want me to remember, or ask me a question.",
    });
    expect(resolveTelegramTextCaptureDisposition("Remember that I prefer morning investor calls on Tuesdays.")).toEqual({
      action: "capture",
    });
    expect(resolveTelegramTextCaptureDisposition("The launch call is at 9.")).toEqual({
      action: "capture",
    });
  });

  it("marks committed hot memory as retrievable metadata", () => {
    const result: TelegramHotMemoryCommitResult = {
      status: "committed",
      reason: null,
      memoryIntake: memoryIntake({
        acknowledgement: "Got it. I will remember that.",
        facts: [{
          kind: "preference",
          slot: "investor_calls",
          qualifier: null,
          value: "morning calls on Tuesdays",
          valueType: "string",
          mutable: true,
          confidence: 0.92,
        }],
      }),
      storedCount: 1,
      replyText: "Got it. I will remember that.",
    };

    expect(telegramHotMemoryCommitMetadata(result)).toEqual({
      status: "committed",
      reason: null,
      retrievable: true,
      storedCount: 1,
      factCount: 1,
      engineeringMemoryCount: 0,
      intakeStatus: "stored",
      intakeSource: "llm",
    });
    expect(telegramTextCaptureReply(result)).toBe("Got it. I will remember that.");
  });

  it("uses captured-only wording when hot memory was not committed", () => {
    const result: TelegramHotMemoryCommitResult = {
      status: "captured_only",
      reason: "no_retrievable_memory",
      memoryIntake: memoryIntake({ status: "no_facts", facts: [] }),
      storedCount: 0,
      replyText: null,
    };

    expect(telegramHotMemoryCommitMetadata(result)).toMatchObject({
      status: "captured_only",
      retrievable: false,
      storedCount: 0,
      intakeStatus: "no_facts",
    });
    expect(telegramTextCaptureReply(result)).toBe("Captured. I'll process this into memory shortly.");
  });
});

function memoryIntake(
  overrides: Partial<MemoryIntakeResult>,
): MemoryIntakeResult {
  return {
    source: "llm",
    status: "stored",
    facts: [],
    engineeringMemories: [],
    acknowledgement: null,
    ...overrides,
  };
}
