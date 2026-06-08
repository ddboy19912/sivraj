import { describe, expect, it } from "vitest";
import {
  buildMemorySearchAuditMetadata,
  buildMemorySearchResponse,
  escapeLike,
  orderRowsById,
  readMemorySearchPrivateReaderError,
} from "./memory-search-handler.js";

describe("memory search handler helpers", () => {
  it("detects missing private memory readers", () => {
    expect(readMemorySearchPrivateReaderError({
      encryptedRowCount: 2,
      privateMemoryReader: null,
    })).toEqual({
      status: 503,
      body: { error: "private_memory_reader_not_configured" },
    });
    expect(readMemorySearchPrivateReaderError({
      encryptedRowCount: 0,
      privateMemoryReader: null,
    })).toBeNull();
  });

  it("orders rows by shortlist ids", () => {
    expect(orderRowsById([
      { id: "fragment-2" },
      { id: "fragment-1" },
    ], ["fragment-1", "fragment-2"])).toEqual([
      { id: "fragment-1" },
      { id: "fragment-2" },
    ]);
  });

  it("escapes like patterns", () => {
    expect(escapeLike("100%_done")).toBe("100\\%\\_done");
  });

  it("builds audit metadata and responses", () => {
    const canonicalMemoryIdsByFragmentId = new Map([
      ["fragment-1", "canonical-1"],
    ]);
    const results = [{
      memory: {
        id: "fragment-1",
        sourceArtifactId: "artifact-1",
        content: "Use pnpm",
      },
      score: 1,
      matchedTerms: ["pnpm"],
    }];

    expect(buildMemorySearchAuditMetadata({
      query: "pnpm",
      results,
      duplicateResultCount: 0,
      decryptFailureCount: 0,
      decryptSkippedCount: 0,
      mode: "index_shortlist",
      indexMatchCount: 1,
      searchedFragmentCount: 1,
      timing: { totalMs: 12 },
      auth: { type: "agent", sub: "agent-1", clientId: "client-1" },
      canonicalMemoryIdsByFragmentId,
    })).toMatchObject({
      query: "pnpm",
      resultCount: 1,
      canonicalMemoryIds: ["canonical-1"],
    });

    expect(buildMemorySearchResponse({
      query: "pnpm",
      results,
      canonicalMemoryIdsByFragmentId,
      mode: "index_shortlist",
      indexMatchCount: 1,
      rows: [{ id: "fragment-1" } as never],
      encryptedRowCount: 0,
      selectedForDecryptCount: 1,
      decryptedCandidateCount: 1,
      decryptSkippedCount: 0,
      decryptFailureCount: 0,
      duplicateResultCount: 0,
      decryptEvidenceLimit: 10,
      timing: { totalMs: 12 },
    })).toMatchObject({
      query: "pnpm",
      results: [{
        id: "fragment-1",
        canonicalMemoryId: "canonical-1",
      }],
    });
  });
});
