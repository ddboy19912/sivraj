import { describe, expect, it } from "vitest";
import {
  buildCanonicalMemoryKey,
  canonicalSubjectMatchScore,
  maxNullableNumber,
  mergeCanonicalMemoryMetadata,
  normalizeCanonicalText,
  rankCanonicalMergeCandidates,
} from "./canonical-memory.js";

describe("normalizeCanonicalText", () => {
  it("normalizes subjects for canonical keys", () => {
    expect(normalizeCanonicalText("Hello World!")).toBe("hello_world");
  });
});

describe("canonicalSubjectMatchScore", () => {
  it("scores exact and partial subject matches", () => {
    expect(canonicalSubjectMatchScore("Hello World", "hello_world")).toBe(3);
    expect(canonicalSubjectMatchScore("Hello World Team", "hello_world")).toBe(2);
    expect(canonicalSubjectMatchScore("Other", "hello_world")).toBe(0);
    expect(canonicalSubjectMatchScore(null, "hello_world")).toBe(0);
  });
});

describe("rankCanonicalMergeCandidates", () => {
  it("prioritizes subject matches and recency", () => {
    const rows = [
      { id: "1", subject: "Other topic", updatedAt: new Date("2026-01-02") },
      { id: "2", subject: "Hello World", updatedAt: new Date("2026-01-01") },
      { id: "3", subject: "Hello World Team", updatedAt: new Date("2026-01-03") },
    ];

    expect(rankCanonicalMergeCandidates(rows, "Hello World").map((row) => row.id)).toEqual([
      "2",
      "3",
      "1",
    ]);
  });
});

describe("buildCanonicalMemoryKey", () => {
  it("prefers subject keys when available", () => {
    expect(buildCanonicalMemoryKey("preference", { memoryMetadata: { category: "Style" } }, "Use pnpm"))
      .toBe("subject:preference:use_pnpm:style");
  });

  it("falls back to statement and evidence hashes", () => {
    expect(buildCanonicalMemoryKey("fact", { normalizedStatementHash: "ABC" }, null))
      .toBe("statement:fact:abc");
    expect(buildCanonicalMemoryKey("fact", { evidenceHash: "hash-1" }, null))
      .toBe("evidence:fact:hash-1");
  });
});

describe("mergeCanonicalMemoryMetadata", () => {
  it("merges evidence references and semantic merge metadata", () => {
    const merged = mergeCanonicalMemoryMetadata(
      { evidenceHashes: ["a"], sourceArtifactIds: ["artifact-1"] },
      { subject: "Updated subject", sourceType: "markdown" },
      {
        sourceArtifactId: "artifact-2",
        memoryFragmentId: "fragment-1",
        evidenceHash: "b",
        semanticMerge: {
          decision: "same",
          canonicalMemoryId: "canonical-1",
          confidence: 0.9,
          reason: "Same preference",
        },
      },
    );

    expect(merged.evidenceHashes).toEqual(["a", "b"]);
    expect(merged.sourceArtifactIds).toEqual(["artifact-1", "artifact-2"]);
    expect(merged.memoryFragmentIds).toEqual(["fragment-1"]);
    expect(merged.consolidationMethod).toBe("llm_semantic_merge_judgment");
    expect(merged.subject).toBe("Updated subject");
  });
});

describe("maxNullableNumber", () => {
  it("returns the greater non-null score", () => {
    expect(maxNullableNumber(0.4, 0.8)).toBe(0.8);
    expect(maxNullableNumber(null, 0.5)).toBe(0.5);
    expect(maxNullableNumber(0.6, null)).toBe(0.6);
  });
});
