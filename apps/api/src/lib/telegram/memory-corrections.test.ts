import { describe, expect, it } from "vitest";
import {
  buildTelegramMemoryCorrectionSearchText,
  normalizeTelegramMemoryCorrectionQuery,
  tokenizeTelegramMemoryCorrectionQuery,
} from "./memory-correction-matching.js";

describe("Telegram memory correction helpers", () => {
  it("normalizes correction queries without changing meaning", () => {
    expect(normalizeTelegramMemoryCorrectionQuery("  dog    name  ")).toBe("dog name");
  });

  it("tokenizes memory correction queries for matching", () => {
    expect(tokenizeTelegramMemoryCorrectionQuery("Dog's name: Bosco, dog name")).toEqual([
      "dog",
      "name",
      "bosco",
    ]);
  });

  it("builds searchable text from canonical current-truth metadata", () => {
    const text = buildTelegramMemoryCorrectionSearchText({
      memoryType: "fact",
      canonicalKey: "profile_fact:user:occupation",
      subject: "Fortune",
      metadata: {
        currentTruth: {
          kind: "profile_fact",
          slot: "occupation",
          value: "lawyer",
          sourceMessagePreview: "I am a lawyer.",
        },
      },
    });

    expect(text).toContain("occupation");
    expect(text).toContain("lawyer");
    expect(text).toContain("fortune");
  });

  it("builds searchable text from candidate nested current-truth metadata", () => {
    const text = buildTelegramMemoryCorrectionSearchText({
      memoryType: "preference",
      metadata: {
        memoryMetadata: {
          category: "preference",
          currentTruth: {
            slot: "investor_calls",
            value: "morning calls on Tuesdays",
          },
        },
      },
    });

    expect(text).toContain("investor_calls");
    expect(text).toContain("morning calls on tuesdays");
  });
});
