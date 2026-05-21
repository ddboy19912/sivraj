import type { ParsedArtifact } from "../types.js";

const GITHUB_PARSER_NAME = "github";

export function parseGitHubImport(input: {
  content: string;
  title?: string | null;
}): ParsedArtifact {
  const originalLength = input.content.length;
  const warnings: string[] = [];
  const content = normalizeGitHubImport(input.content);

  if (!content) {
    warnings.push("github_import_empty_after_parse");
  }

  return {
    content,
    parser: {
      name: GITHUB_PARSER_NAME,
      originalLength,
      parsedLength: content.length,
      warnings,
    },
  };
}

function normalizeGitHubImport(content: string): string {
  return content
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trimEnd())
    .join("\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}
