import { describe, expect, it, vi } from "vitest";
import type { MemoryCandidate } from "@sivraj/retrieval";

const memoryRetrievalMocks = vi.hoisted(() => ({
  loadCanonicalCurrentTruthSearchCandidates: vi.fn(),
  selectCurrentTruthMemoryResults: vi.fn(),
  shouldUseHotCurrentTruthFallback: vi.fn(),
  loadCandidateMemorySearchCandidates: vi.fn(),
  rankChatMemoryResults: vi.fn(),
  loadSearchRows: vi.fn(),
  loadCanonicalMemoryIdsByFragmentId: vi.fn(),
}));

vi.mock("./current-truth.js", () => ({
  loadCanonicalCurrentTruthSearchCandidates: memoryRetrievalMocks.loadCanonicalCurrentTruthSearchCandidates,
  selectCurrentTruthMemoryResults: memoryRetrievalMocks.selectCurrentTruthMemoryResults,
  shouldUseHotCurrentTruthFallback: memoryRetrievalMocks.shouldUseHotCurrentTruthFallback,
}));

vi.mock("./candidate-memory-search.js", () => ({
  loadCandidateMemorySearchCandidates: memoryRetrievalMocks.loadCandidateMemorySearchCandidates,
}));

vi.mock("./memory-ranking.js", () => ({
  rankChatMemoryResults: memoryRetrievalMocks.rankChatMemoryResults,
}));

vi.mock("../memory-search/load.js", () => ({
  loadSearchRows: memoryRetrievalMocks.loadSearchRows,
  loadCanonicalMemoryIdsByFragmentId: memoryRetrievalMocks.loadCanonicalMemoryIdsByFragmentId,
}));

const { loadMemoryContext } = await import("./memory-retrieval.js");

describe("loadMemoryContext", () => {
  it("continues to archived candidate memories when memory QA has no current-truth hit", async () => {
    const candidate = memoryCandidate(
      "candidate-1",
      "professional profile_fact memory: Fortune is a software engineer.",
    );

    memoryRetrievalMocks.loadCanonicalCurrentTruthSearchCandidates.mockResolvedValue({
      candidates: [],
      canonicalMemoryIdsByCandidateId: new Map(),
      tokenAccountingByCandidateId: new Map(),
    });
    memoryRetrievalMocks.selectCurrentTruthMemoryResults.mockReturnValue([]);
    memoryRetrievalMocks.shouldUseHotCurrentTruthFallback.mockReturnValue(true);
    memoryRetrievalMocks.loadSearchRows.mockResolvedValue({
      rows: [],
      mode: "recent_fallback",
      indexMatchCount: 0,
    });
    memoryRetrievalMocks.loadCanonicalMemoryIdsByFragmentId.mockResolvedValue(new Map());
    memoryRetrievalMocks.loadCandidateMemorySearchCandidates.mockResolvedValue({
      candidates: [candidate],
      canonicalMemoryIdsByCandidateId: new Map(),
      tokenAccountingByCandidateId: new Map(),
    });
    memoryRetrievalMocks.rankChatMemoryResults.mockImplementation(async ({ candidates }) =>
      candidates.some((entry: MemoryCandidate) => entry.id === candidate.id)
        ? [{ memory: candidate, score: 0.91, matchedTerms: ["software", "engineer"] }]
        : []
    );

    const context = await loadMemoryContext({
      db: {} as any,
      privateMemoryReader: {} as any,
      memorySearchConfig: memorySearchConfig(),
      twinId: "twin-1",
      query: "What is my job?",
      contextResolution: {
        retrieval: "hot_memory",
        answerTarget: "memory",
        intent: "memory_qa",
      },
      runtimeConfig: {
        id: "provider-1",
        providerKind: "openai",
        displayName: "OpenAI",
        baseUrl: "https://example.com/v1",
        model: "gpt-test",
        apiKey: "test-key",
        source: "user",
      },
    });

    expect(memoryRetrievalMocks.loadCandidateMemorySearchCandidates).toHaveBeenCalled();
    expect(context.results.map((result) => result.memory.content)).toEqual([
      "professional profile_fact memory: Fortune is a software engineer.",
    ]);
  });
});

function memoryCandidate(id: string, content: string): MemoryCandidate {
  return {
    id,
    twinId: "twin-1",
    sourceArtifactId: "artifact-1",
    content,
    summary: content,
    importanceScore: 0.9,
    confidenceScore: 0.9,
    occurredAt: null,
    createdAt: new Date("2026-06-21T00:00:00.000Z"),
  };
}

function memorySearchConfig() {
  return {
    shortlistLimit: 10,
    fallbackLimit: 10,
    decryptEvidenceLimit: 5,
    decryptConcurrency: 1,
  } as any;
}

