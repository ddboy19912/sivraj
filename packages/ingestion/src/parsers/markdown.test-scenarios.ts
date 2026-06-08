import { expect } from "vitest";

import { parseMarkdown } from "./markdown.js";

export async function run_parsemarkdown_turns_headings_paragraphs_and_lists_into_readable_text() {
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
}

export async function run_parsemarkdown_removes_yaml_frontmatter() {
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
}

export async function run_parsemarkdown_keeps_readable_link_text_without_markdown_syntax() {
  const parsed = parseMarkdown({
      content: "Use the [compliance-first framework](https://example.com) for bank buyers.",
    });

    expect(parsed.content).toBe("Use the compliance-first framework for bank buyers.");
}

export async function run_parsemarkdown_preserves_fenced_code_blocks_with_light_boundaries() {
  const parsed = parseMarkdown({
      content: ["```ts", "const angle = 'trust';", "```"].join("\n"),
    });

    expect(parsed.content).toBe("Code block (ts):\nconst angle = 'trust';");
}

export async function run_parsemarkdown_returns_an_empty_parse_result_for_format_only_markdown() {
  const parsed = parseMarkdown({ content: "---\n---\n\n---" });

    expect(parsed.content).toBe("");
    expect(parsed.parser.warnings).toContain("markdown_empty_after_parse");
}
