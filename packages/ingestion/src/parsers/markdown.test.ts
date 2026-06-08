import { describe, expect, it } from "vitest";
import { parseMarkdown } from "./markdown.js";
import {
  run_parsemarkdown_turns_headings_paragraphs_and_lists_into_readable_text,
  run_parsemarkdown_removes_yaml_frontmatter,
  run_parsemarkdown_keeps_readable_link_text_without_markdown_syntax,
  run_parsemarkdown_preserves_fenced_code_blocks_with_light_boundaries,
  run_parsemarkdown_returns_an_empty_parse_result_for_format_only_markdown
} from "./markdown.test-scenarios.js";

describe("parseMarkdown", () => {
  it("turns headings, paragraphs, and lists into readable text", () => run_parsemarkdown_turns_headings_paragraphs_and_lists_into_readable_text());
});

describe("parseMarkdown", () => {
  it("removes yaml frontmatter", () => run_parsemarkdown_removes_yaml_frontmatter());
});

describe("parseMarkdown", () => {
  it("keeps readable link text without markdown syntax", () => run_parsemarkdown_keeps_readable_link_text_without_markdown_syntax());
});

describe("parseMarkdown", () => {
  it("preserves fenced code blocks with light boundaries", () => run_parsemarkdown_preserves_fenced_code_blocks_with_light_boundaries());
});

describe("parseMarkdown", () => {
  it("returns an empty parse result for format-only markdown", () => run_parsemarkdown_returns_an_empty_parse_result_for_format_only_markdown());
});
