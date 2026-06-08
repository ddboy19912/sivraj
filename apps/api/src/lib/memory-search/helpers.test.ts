import { describe, expect, it } from "vitest";
import {
  clampResultLimit,
  buildMemorySearchPolicy,
  collectDecryptedCandidates,
  dedupeRetrievalResults,
  mapMemorySearchResults,
  normalizeRetrievedContent,
  selectRowsForDecrypt,
  shouldRejectSearchAfterDecryptFailures,
} from "./helpers.js";

describe("memory search helpers", () => {
  it("clamps result limits", () => {
    expect(clampResultLimit(undefined)).toBe(5);
    expect(clampResultLimit(100)).toBe(20);
    expect(clampResultLimit(0)).toBe(5);
  });

  it("normalizes retrieved content", () => {
    expect(normalizeRetrievedContent("Hello, World!")).toBe("hello world");
  });

  it("dedupes retrieval results by canonical id", () => {
    const results = dedupeRetrievalResults([
      {
        memory: { id: "fragment-1", sourceArtifactId: "a-1", content: "Use pnpm" },
        score: 1,
        matchedTerms: ["pnpm"],
      },
      {
        memory: { id: "fragment-2", sourceArtifactId: "a-2", content: "Use pnpm" },
        score: 0.9,
        matchedTerms: ["pnpm"],
      },
    ], 5, new Map([
      ["fragment-1", "canonical-1"],
      ["fragment-2", "canonical-1"],
    ]));

    expect(results.results).toHaveLength(1);
    expect(results.duplicateResultCount).toBe(1);
  });

  it("selects rows for decrypt with canonical dedupe", () => {
    const rows = selectRowsForDecrypt({
      rows: [
        { id: "fragment-1" },
        { id: "fragment-2" },
        { id: "fragment-3" },
      ],
      canonicalMemoryIdsByFragmentId: new Map([
        ["fragment-1", "canonical-1"],
        ["fragment-2", "canonical-1"],
      ]),
      limit: 5,
      decryptEvidenceLimit: 10,
    });

    expect(rows.map((row) => row.id)).toEqual(["fragment-1", "fragment-3"]);
  });

  it("builds memory search policy payloads", () => {
    expect(buildMemorySearchPolicy({
      mode: "index_shortlist",
      indexMatchCount: 2,
      rows: [{}, {}],
      encryptedRowCount: 1,
      selectedForDecryptCount: 1,
      decryptedCandidateCount: 1,
      decryptSkippedCount: 1,
      decryptFailureCount: 0,
      duplicateResultCount: 0,
      decryptEvidenceLimit: 10,
      timing: { totalMs: 12 },
      agentScopeAccepted: "memory:search",
    })).toMatchObject({
      searchMode: "index_shortlist",
      searchedFragmentCount: 2,
      timing: { totalMs: 12 },
    });
  });

  it("detects decrypt failure rejections and maps results", () => {
    expect(shouldRejectSearchAfterDecryptFailures({
      encryptedRowCount: 2,
      candidateCount: 0,
      decryptFailureCount: 1,
    })).toBe(true);

    const { candidates, decryptFailureCount } = collectDecryptedCandidates([
      { status: "fulfilled", value: { id: "m-1", sourceArtifactId: "a-1", content: "hello" } },
      { status: "rejected", reason: new Error("decrypt failed") },
    ]);

    expect(candidates).toHaveLength(1);
    expect(decryptFailureCount).toBe(1);

    expect(mapMemorySearchResults([
      {
        memory: { id: "fragment-1", sourceArtifactId: "a-1", content: "hello" },
        score: 1,
        matchedTerms: ["hello"],
      },
    ], new Map([["fragment-1", "canonical-1"]]))).toEqual([{
      id: "fragment-1",
      sourceArtifactId: "a-1",
      content: "hello",
      score: 1,
      matchedTerms: ["hello"],
      canonicalMemoryId: "canonical-1",
      citation: { sourceArtifactId: "a-1" },
    }]);
  });
});
