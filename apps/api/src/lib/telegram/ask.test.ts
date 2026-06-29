import { describe, expect, it } from "vitest";
import {
  buildTelegramAnswerSources,
  extractTelegramCapturedText,
  formatTelegramAnswerText,
  isNonTerminalTelegramAnswer,
  shouldUseFreshTelegramCapture,
  type TelegramAnswerSource,
} from "./ask.js";

describe("Telegram ask helpers", () => {
  it("formats empty answers with a safe fallback", () => {
    expect(formatTelegramAnswerText({ answer: "  " })).toBe("I do not have an answer yet.");
  });

  it("replaces non-terminal Telegram answers with a truthful final reply", () => {
    expect(isNonTerminalTelegramAnswer(
      'I can summarize the "Sivraj_Demo_Launch_Notes.pdf" for you. Please give me a moment to process it.',
    )).toBe(true);
    expect(formatTelegramAnswerText({
      answer: 'I can summarize the "Sivraj_Demo_Launch_Notes.pdf" for you. Please give me a moment to process it.',
    })).toBe("I couldn’t complete that answer in this Telegram turn. Please ask again and I’ll answer directly, or tell you if the source is unreadable.");
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
    const formatted = formatTelegramAnswerText({ answer: "a".repeat(5000) });

    expect(formatted.length).toBeLessThanOrEqual(3900);
    expect(formatted.endsWith("[truncated]")).toBe(true);
  });

  it("omits the source footer when there are no sources", () => {
    expect(formatTelegramAnswerText({
      answer: "You prefer morning investor calls.",
      sources: [],
    })).toBe("You prefer morning investor calls.");
  });

  it("appends sources in compact numbered format", () => {
    const formatted = formatTelegramAnswerText({
      answer: "You prefer morning investor calls.",
      sources: [
        telegramAnswerSource({
          displayName: "Telegram Message",
          sourceType: "Telegram message",
          createdAt: new Date("2026-06-27T13:00:00.000Z"),
        }),
        telegramAnswerSource({
          artifactId: "artifact-2",
          displayName: "Sivraj_Demo_Launch_Notes.pdf",
          sourceType: "PDF",
          createdAt: new Date("2026-06-24T09:00:00.000Z"),
        }),
      ],
    });

    expect(formatted).toBe([
      "You prefer morning investor calls.",
      "",
      "Sources:",
      "1. Telegram Message · Telegram message · 2026-06-27",
      "2. Sivraj_Demo_Launch_Notes.pdf · PDF · 2026-06-24",
    ].join("\n"));
  });

  it("truncates long answers while preserving the source footer", () => {
    const formatted = formatTelegramAnswerText({
      answer: "a".repeat(5000),
      sources: [
        telegramAnswerSource({
          displayName: "Telegram Message",
          sourceType: "Telegram message",
          createdAt: new Date("2026-06-27T13:00:00.000Z"),
        }),
      ],
    });

    expect(formatted.length).toBeLessThanOrEqual(3900);
    expect(formatted).toContain("[truncated]\n\nSources:");
    expect(formatted.endsWith("1. Telegram Message · Telegram message · 2026-06-27")).toBe(true);
  });

  it("hydrates sources by citation order, dedupes artifact citations, and skips missing artifacts", () => {
    const createdAt = new Date("2026-06-27T13:00:00.000Z");

    expect(buildTelegramAnswerSources({
      citations: [
        { label: "MEM_1", sourceArtifactId: "artifact-1" },
        { label: "DOC_2", sourceArtifactId: "missing-artifact" },
        { label: "MEM_2", sourceArtifactId: "artifact-1" },
        { label: "DOC_3", sourceArtifactId: "artifact-2" },
      ],
      artifacts: [
        {
          id: "artifact-2",
          sourceType: "pdf",
          metadata: { fileName: "Launch Notes.pdf" },
          createdAt,
        },
        {
          id: "artifact-1",
          sourceType: "telegram_message",
          metadata: { sourceDisplayName: "Telegram Message" },
          createdAt,
        },
      ],
    })).toEqual([
      {
        artifactId: "artifact-1",
        displayName: "Telegram Message",
        sourceType: "Telegram message",
        createdAt,
        citationLabels: ["MEM_1", "MEM_2"],
      },
      {
        artifactId: "artifact-2",
        displayName: "Launch Notes.pdf",
        sourceType: "PDF",
        createdAt,
        citationLabels: ["DOC_3"],
      },
    ]);
  });

  it("selects source display labels by metadata precedence", () => {
    const createdAt = new Date("2026-06-27T13:00:00.000Z");
    const sources = buildTelegramAnswerSources({
      citations: [
        { sourceArtifactId: "artifact-1" },
        { sourceArtifactId: "artifact-2" },
        { sourceArtifactId: "artifact-3" },
      ],
      artifacts: [
        {
          id: "artifact-1",
          sourceType: "telegram_message",
          metadata: {
            sourceDisplayName: "Forwarded founder chat",
            fileName: "ignored.pdf",
            title: "Ignored title",
          },
          createdAt,
        },
        {
          id: "artifact-2",
          sourceType: "pdf",
          metadata: {
            fileName: "Deck Notes.pdf",
            title: "Ignored title",
          },
          createdAt,
        },
        {
          id: "artifact-3",
          sourceType: "url",
          metadata: {
            title: "Customer discovery writeup",
          },
          createdAt,
        },
      ],
    });

    expect(sources.map((source) => source.displayName)).toEqual([
      "Forwarded founder chat",
      "Deck Notes.pdf",
      "Customer discovery writeup",
    ]);
  });

  it("falls back to readable source type when metadata has no display label", () => {
    const createdAt = new Date("2026-06-27T13:00:00.000Z");

    expect(buildTelegramAnswerSources({
      citations: [{ sourceArtifactId: "artifact-1" }],
      artifacts: [
        {
          id: "artifact-1",
          sourceType: "voice_note",
          metadata: {},
          createdAt,
        },
      ],
    })[0]?.displayName).toBe("Voice note");
  });
});

function telegramAnswerSource(overrides: Partial<TelegramAnswerSource> = {}): TelegramAnswerSource {
  return {
    artifactId: "artifact-1",
    displayName: "Telegram Message",
    sourceType: "Telegram message",
    createdAt: new Date("2026-06-27T13:00:00.000Z"),
    citationLabels: ["MEM_1"],
    ...overrides,
  };
}
