import { describe, expect, it } from "vitest";
import { readContextExportContent, readContextExportMarkdown } from "./context-export.js";

describe("readContextExportContent", () => {
  it("reads nested export content", () => {
    expect(readContextExportContent({
      contextExport: { content: "# Context" },
    })).toBe("# Context");
    expect(readContextExportContent({ contextExport: { content: 1 } })).toBeNull();
  });
});

describe("readContextExportMarkdown", () => {
  it("falls back to contextMarkdown", () => {
    expect(readContextExportMarkdown({ contextMarkdown: "fallback" })).toBe("fallback");
  });
});
