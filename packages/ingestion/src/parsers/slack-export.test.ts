import { describe, expect, it } from "vitest";
import { parseSlackExport } from "./slack-export.js";

describe("parseSlackExport", () => {
  it("extracts Slack json message exports", () => {
    const parsed = parseSlackExport({
      content: JSON.stringify([
        {
          user: "U123",
          text: "Lead with <https://example.com|trust> in <#C123|strategy>.",
          ts: "1711965600.000000",
        },
      ]),
    });

    expect(parsed.content).toBe("[1711965600.000000] U123: Lead with trust in #strategy.");
    expect(parsed.parser.warnings).toEqual([]);
  });

  it("falls back to plain readable text for non-json exports", () => {
    const parsed = parseSlackExport({
      content: "U123: Lead with <https://example.com|trust>.",
    });

    expect(parsed.content).toBe("U123: Lead with trust.");
    expect(parsed.parser.warnings).toContain("slack_export_parse_recovered_with_plain_text");
  });

  it("returns an empty parse result for empty Slack exports", () => {
    const parsed = parseSlackExport({ content: "[]" });

    expect(parsed.content).toBe("");
    expect(parsed.parser.warnings).toContain("slack_export_empty_after_parse");
  });
});
