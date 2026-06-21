import { beforeEach, describe, expect, it, vi } from "vitest";
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

const { loadMemoryContext, memoryQueryTerms } = await import("./memory-retrieval.js");

describe("memoryQueryTerms", () => {
  it("uses planner-provided semantic terms instead of hardcoded stop words", () => {
    expect(memoryQueryTerms("What is my job?", {
      memoryRequest: {
        kind: "specific_fact",
        query: "What is my job?",
        scope: "profile",
        searchTerms: ["occupation", "job"],
      },
    })).toEqual(["occupation", "job"]);
    expect(memoryQueryTerms("Do you have any other memory about me?", {
      memoryRequest: {
        kind: "followup",
        relation: "other",
        query: "Do you have any other memory about me?",
        scope: "profile",
        excludeAlreadyMentioned: true,
        searchTerms: [],
      },
    })).toEqual([]);
  });
});

describe("loadMemoryContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

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
        memoryRequest: {
          kind: "specific_fact",
          query: "What is my job?",
          scope: "profile",
          searchTerms: ["job"],
        },
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

    expect(memoryRetrievalMocks.loadSearchRows).toHaveBeenCalledWith(
      expect.objectContaining({ queryTerms: ["job"] }),
    );
    expect(memoryRetrievalMocks.loadCandidateMemorySearchCandidates).toHaveBeenCalledWith(
      expect.objectContaining({ queryTerms: ["job"] }),
    );
    expect(context.results.map((result) => result.memory.content)).toEqual([
      "professional profile_fact memory: Fortune is a software engineer.",
    ]);
  });

  it("does not let current-truth fallback block archived candidate memories", async () => {
    const currentTruth = memoryCandidate(
      "canonical-current-truth:name-1",
      "Current profile fact: Fortune's name is Fortune.",
    );
    const candidate = memoryCandidate(
      "candidate-1",
      "professional profile_fact memory: Fortune is a software engineer.",
    );

    memoryRetrievalMocks.loadCanonicalCurrentTruthSearchCandidates.mockResolvedValue({
      candidates: [currentTruth],
      canonicalMemoryIdsByCandidateId: new Map([[currentTruth.id, "canonical-name-1"]]),
      tokenAccountingByCandidateId: new Map(),
    });
    memoryRetrievalMocks.selectCurrentTruthMemoryResults.mockReturnValue([
      { memory: currentTruth, score: 30, matchedTerms: ["current-truth"] },
    ]);
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
        memoryRequest: {
          kind: "specific_fact",
          query: "What is my job?",
          scope: "profile",
          searchTerms: ["job"],
        },
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
      "Current profile fact: Fortune's name is Fortune.",
    ]);
  });

  it("returns a profile inventory without engineering memories for about-me questions", async () => {
    const nameMemory = memoryCandidate(
      "canonical-current-truth:name-1",
      "Current profile fact: Fortune's name is Fortune.",
    );
    const engineeringMemory = memoryCandidate(
      "canonical-current-truth:rg-1",
      "Engineering memory: Coding agents should use rg before grep.\nType: tool_preference\nKind: engineering_memory",
    );
    const jobMemory = memoryCandidate(
      "candidate-job-1",
      "professional fact memory: Fortune is a software engineer.",
    );
    const rgCandidate = memoryCandidate(
      "candidate-rg-1",
      "repo_search fact memory: The user prefers rg for repository search before slower alternatives.",
    );

    memoryRetrievalMocks.loadCanonicalCurrentTruthSearchCandidates.mockResolvedValue({
      candidates: [nameMemory, engineeringMemory],
      canonicalMemoryIdsByCandidateId: new Map(),
      tokenAccountingByCandidateId: new Map(),
    });
    memoryRetrievalMocks.selectCurrentTruthMemoryResults.mockReturnValue([
      { memory: nameMemory, score: 30, matchedTerms: ["current-truth"] },
      { memory: engineeringMemory, score: 29, matchedTerms: ["current-truth"] },
    ]);
    memoryRetrievalMocks.shouldUseHotCurrentTruthFallback.mockReturnValue(true);
    memoryRetrievalMocks.loadSearchRows.mockResolvedValue({
      rows: [],
      mode: "recent_fallback",
      indexMatchCount: 0,
    });
    memoryRetrievalMocks.loadCanonicalMemoryIdsByFragmentId.mockResolvedValue(new Map());
    memoryRetrievalMocks.loadCandidateMemorySearchCandidates.mockResolvedValue({
      candidates: [jobMemory, rgCandidate],
      canonicalMemoryIdsByCandidateId: new Map(),
      tokenAccountingByCandidateId: new Map(),
    });
    memoryRetrievalMocks.rankChatMemoryResults.mockResolvedValue([]);

    const context = await loadMemoryContext({
      db: {} as any,
      privateMemoryReader: {} as any,
      memorySearchConfig: memorySearchConfig(),
      twinId: "twin-1",
      query: "What memories do you have about me?",
      contextResolution: {
        retrieval: "hot_memory",
        answerTarget: "memory",
        intent: "memory_qa",
        memoryRequest: {
          kind: "inventory",
          scope: "profile",
          excludeAlreadyMentioned: false,
        },
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

    expect(context.results.map((result) => result.memory.content)).toEqual([
      "Current profile fact: Fortune's name is Fortune.",
      "professional fact memory: Fortune is a software engineer.",
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
