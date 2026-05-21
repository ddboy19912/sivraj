import { describe, expect, it } from "vitest";
import { parseChatExport } from "./chat-export.js";

describe("parseChatExport", () => {
  it("extracts common message arrays from json exports", () => {
    const parsed = parseChatExport({
      content: JSON.stringify({
        messages: [
          {
            role: "user",
            timestamp: "2024-03-01T10:00:00Z",
            content: "What angle should I use?",
          },
          {
            role: "assistant",
            content: "Lead with compliance and trust.",
          },
        ],
      }),
    });

    expect(parsed.content).toBe(
      [
        "[2024-03-01T10:00:00Z] user: What angle should I use?",
        "assistant: Lead with compliance and trust.",
      ].join("\n"),
    );
    expect(parsed.parser.warnings).toEqual([]);
  });

  it("falls back to readable text for non-json exports", () => {
    const parsed = parseChatExport({
      content: "Tunde: Need pitch help.\nAI: Lead with trust.",
    });

    expect(parsed.content).toBe("Tunde: Need pitch help.\nAI: Lead with trust.");
    expect(parsed.parser.warnings).toContain("chat_export_parse_recovered_with_plain_text");
  });

  it("returns an empty parse result for empty exports", () => {
    const parsed = parseChatExport({ content: "[]" });

    expect(parsed.content).toBe("");
    expect(parsed.parser.warnings).toContain("chat_export_empty_after_parse");
  });
});
