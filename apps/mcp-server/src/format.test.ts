import { describe, expect, it } from "vitest";
import { formatSourceLine } from "./format.js";

describe("formatSourceLine", () => {
  it("formats engineering source summaries", () => {
    expect(formatSourceLine({
      displayName: "AGENTS.md",
      artifactId: "artifact-1",
      sourceType: "markdown",
      extractedEngineeringMemoryCount: 3,
    })).toContain("AGENTS.md");
    expect(formatSourceLine({
      displayName: "AGENTS.md",
      artifactId: "artifact-1",
      sourceType: "markdown",
      extractedEngineeringMemoryCount: 3,
    })).toContain("memories: 3");
  });
});
