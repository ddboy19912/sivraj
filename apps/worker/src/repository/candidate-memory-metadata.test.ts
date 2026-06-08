import { describe, expect, it } from "vitest";
import { buildCandidateConsolidationMetadata } from "./candidate-memory-metadata.js";

describe("buildCandidateConsolidationMetadata", () => {
  it("marks newly created canonical memories", () => {
    expect(buildCandidateConsolidationMetadata({
      metadata: { subject: "Use pnpm" },
      canonicalMemory: {
        id: "canonical-1",
        canonicalKey: "subject:fact:use_pnpm",
        existing: false,
      },
    })).toMatchObject({
      consolidation: "created_canonical_memory",
      canonicalMemoryId: "canonical-1",
    });
  });

  it("marks semantic merges", () => {
    expect(buildCandidateConsolidationMetadata({
      metadata: {},
      canonicalMemory: {
        id: "canonical-1",
        canonicalKey: "subject:fact:use_pnpm",
        existing: true,
        semanticMerge: {
          decision: "same",
          confidence: 0.9,
          reason: "Same preference",
          canonicalMemoryId: "canonical-1",
        },
      },
    })).toMatchObject({
      consolidation: "semantically_merged_into_existing_canonical_memory",
    });
  });
});
