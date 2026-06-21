import { describe, expect, it } from "vitest";
import {
  collectPatternCandidateMemoryIds,
  filterVisibleGraphNodesByPatternEvidence,
  shouldExposeGraphNodeProperties,
} from "./pattern-visibility.js";

describe("graph pattern visibility", () => {
  it("hides repeated pattern nodes backed by one canonical memory", () => {
    expect(
      shouldExposeGraphNodeProperties(
        {
          kind: "pattern",
          patternType: "repeated_preference_subject",
          candidateMemoryIds: ["candidate-chat", "candidate-pdf"],
        },
        new Map([
          ["candidate-chat", "canonical-rg"],
          ["candidate-pdf", "canonical-rg"],
        ]),
      ),
    ).toBe(false);
  });

  it("keeps repeated pattern nodes backed by distinct canonical memories", () => {
    expect(
      shouldExposeGraphNodeProperties(
        {
          kind: "pattern",
          patternType: "repeated_preference_subject",
          canonicalMemoryIds: ["canonical-one", "canonical-two"],
          candidateMemoryIds: ["candidate-one", "candidate-two"],
        },
        new Map(),
      ),
    ).toBe(true);
  });

  it("filters graph nodes and preserves non-pattern nodes", () => {
    const nodes = [
      {
        id: "concept-node",
        properties: { subject: "Sivraj" },
      },
      {
        id: "duplicate-pattern",
        properties: {
          kind: "pattern",
          candidateMemoryIds: ["candidate-a", "candidate-b"],
        },
      },
    ];

    expect(collectPatternCandidateMemoryIds(nodes)).toEqual(["candidate-a", "candidate-b"]);
    expect(
      filterVisibleGraphNodesByPatternEvidence(
        nodes,
        new Map([
          ["candidate-a", "canonical-a"],
          ["candidate-b", "canonical-a"],
        ]),
      ).map((node) => node.id),
    ).toEqual(["concept-node"]);
  });
});
