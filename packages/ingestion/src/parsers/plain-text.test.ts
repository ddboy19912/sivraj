import { describe, expect, it } from "vitest";
import { parsePlainText } from "./plain-text.js";

describe("parsePlainText", () => {
  it("normalizes whitespace while preserving readable paragraphs", () => {
    const parsed = parsePlainText({
      content: "  First   paragraph.  \r\n\r\n\r\n  Second\tparagraph.  ",
    });

    expect(parsed.content).toBe("First paragraph.\n\nSecond paragraph.");
    expect(parsed.parser).toMatchObject({
      name: "plain_text",
      originalLength: expect.any(Number),
      parsedLength: parsed.content.length,
      warnings: [],
    });
  });

  it("preserves simple list-like text", () => {
    const parsed = parsePlainText({
      content: "- Compliance first\n- Trust before features\n\n1. Reduce risk",
    });

    expect(parsed.content).toBe("- Compliance first\n- Trust before features\n\n1. Reduce risk");
  });

  it("removes unsafe control characters", () => {
    const parsed = parsePlainText({
      content: "Useful\u0000 memory\u0007 text",
    });

    expect(parsed.content).toBe("Useful memory text");
    expect(parsed.parser.warnings).toContain("plain_text_control_characters_removed");
  });

  it("returns an empty parse result for whitespace-only text", () => {
    const parsed = parsePlainText({ content: " \n\t\n " });

    expect(parsed.content).toBe("");
    expect(parsed.parser.warnings).toContain("plain_text_empty_after_parse");
  });
});
