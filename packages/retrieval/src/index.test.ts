import { describe, expect, it, vi } from "vitest";
import { retrieveRelevantMemories, tokenize, type MemoryCandidate } from "./index.js";

describe("retrieveRelevantMemories", () => {
  it("ranks memories by query overlap and summary matches", () => {
    vi.setSystemTime(new Date("2026-05-18T00:00:00.000Z"));
    const results = retrieveRelevantMemories(
      [
        candidate({
          id: "launch",
          content: "Launch delays keep happening because UI polish expands late.",
          summary: "Product launch pattern",
        }),
        candidate({
          id: "tax",
          content: "Remember to send finance docs before tax filing.",
          summary: "Finance admin",
        }),
      ],
      { query: "launch UI polish", limit: 3 },
    );

    expect(results.map((result) => result.memory.id)).toEqual(["launch"]);
    expect(results[0]?.matchedTerms).toEqual(["launch", "ui", "polish"]);
  });

  it("returns no results for empty semantic terms", () => {
    expect(retrieveRelevantMemories([candidate({ id: "one" })], { query: "the and to" })).toEqual([]);
  });

  it("deduplicates and normalizes tokens", () => {
    expect(tokenize("Launch, launch! UI-polish")).toEqual(["launch", "ui", "polish"]);
  });
});

function candidate(overrides: Partial<MemoryCandidate>): MemoryCandidate {
  return {
    id: "memory-id",
    twinId: "twin-id",
    sourceArtifactId: "artifact-id",
    content: "Default memory content",
    summary: null,
    importanceScore: 0.5,
    confidenceScore: 0.5,
    occurredAt: null,
    createdAt: new Date("2026-05-18T00:00:00.000Z"),
    ...overrides,
  };
}
