import { describe, expect, it } from "vitest";
import { parseGitHubImport } from "./github.js";

describe("parseGitHubImport", () => {
  it("normalizes GitHub import text while preserving file provenance", () => {
    const parsed = parseGitHubImport({
      content: "GitHub repository: sivraj/app\r\n\r\n\r\n\r\nFile: README.md\n  # Sivraj  ",
    });

    expect(parsed.content).toBe("GitHub repository: sivraj/app\n\n\nFile: README.md\n # Sivraj");
    expect(parsed.parser).toEqual({
      name: "github",
      originalLength: 65,
      parsedLength: 57,
      warnings: [],
    });
  });

  it("returns an empty parse result cleanly", () => {
    const parsed = parseGitHubImport({ content: "    \n\n" });

    expect(parsed.content).toBe("");
    expect(parsed.parser.warnings).toContain("github_import_empty_after_parse");
  });
});
