import { describe, expect, it } from "vitest";
import { parseMarkdown } from "./markdown.js";

describe("parseMarkdown", () => {
  it("turns headings, paragraphs, and lists into readable text", () => {
    const parsed = parseMarkdown({
      content: [
        "# Compliance Pitch",
        "",
        "Lead with **trust** before features.",
        "",
        "- Procurement wants risk reduced.",
        "- Legal wants proof.",
      ].join("\n"),
    });

    expect(parsed.content).toBe(
      [
        "Compliance Pitch",
        "Lead with trust before features.",
        "- Procurement wants risk reduced.",
        "- Legal wants proof.",
      ].join("\n"),
    );
    expect(parsed.parser).toMatchObject({
      name: "markdown",
      originalLength: expect.any(Number),
      parsedLength: parsed.content.length,
      warnings: [],
    });
  });

  it("removes yaml frontmatter", () => {
    const parsed = parseMarkdown({
      content: [
        "---",
        "client: fintech",
        "date: 2024-03-01",
        "---",
        "",
        "# Positioning",
        "",
        "Compliance removed procurement friction.",
      ].join("\n"),
    });

    expect(parsed.content).toBe(
      ["Positioning", "Compliance removed procurement friction."].join("\n"),
    );
  });

  it("keeps readable link text without markdown syntax", () => {
    const parsed = parseMarkdown({
      content: "Use the [compliance-first framework](https://example.com) for bank buyers.",
    });

    expect(parsed.content).toBe("Use the compliance-first framework for bank buyers.");
  });

  it("preserves fenced code blocks with light boundaries", () => {
    const parsed = parseMarkdown({
      content: ["```ts", "const angle = 'trust';", "```"].join("\n"),
    });

    expect(parsed.content).toBe("Code block (ts):\nconst angle = 'trust';");
  });

  it("returns an empty parse result for format-only markdown", () => {
    const parsed = parseMarkdown({ content: "---\n---\n\n---" });

    expect(parsed.content).toBe("");
    expect(parsed.parser.warnings).toContain("markdown_empty_after_parse");
  });
});
