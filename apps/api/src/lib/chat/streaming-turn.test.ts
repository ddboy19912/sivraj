import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatRuntimeConfig, ChatTurnSeed } from "../../types/chat.types.js";
import type { ConversationContextResolution } from "./turn-types.js";

const mockChatTurn = vi.hoisted(() => ({
  createQueuedTurn: vi.fn(),
  markTurnRetrievingContext: vi.fn(),
  markTurnGenerating: vi.fn(),
  markTurnCancelled: vi.fn(),
  markTurnFailed: vi.fn(),
  recordChatMemoryIntakeOutcome: vi.fn(),
  completeStreamingTurn: vi.fn(),
  recordCompletedStreamingTurnAudit: vi.fn(),
  updateAssistantPartial: vi.fn(),
  loadCachedRuntimeProviderConfig: vi.fn(),
  loadCachedCoreCommsContext: vi.fn(),
  loadThreadMessages: vi.fn(),
  loadTurnPlanningMemoryHints: vi.fn(),
  resolveConversationContext: vi.fn(),
  loadMemoryContext: vi.fn(),
  createOpenAICompatibleChatGenerator: vi.fn(),
  enqueueCompletedChatTurnLearning: vi.fn(),
}));

vi.mock("@sivraj/llm", () => ({
  createOpenAICompatibleChatGenerator: mockChatTurn.createOpenAICompatibleChatGenerator,
}));

vi.mock("./turn-persistence.js", () => ({
  createQueuedTurn: mockChatTurn.createQueuedTurn,
  markTurnRetrievingContext: mockChatTurn.markTurnRetrievingContext,
  markTurnGenerating: mockChatTurn.markTurnGenerating,
  markTurnCancelled: mockChatTurn.markTurnCancelled,
  markTurnFailed: mockChatTurn.markTurnFailed,
  recordChatMemoryIntakeOutcome: mockChatTurn.recordChatMemoryIntakeOutcome,
  completeStreamingTurn: mockChatTurn.completeStreamingTurn,
  recordCompletedStreamingTurnAudit: mockChatTurn.recordCompletedStreamingTurnAudit,
  updateAssistantPartial: mockChatTurn.updateAssistantPartial,
}));

vi.mock("./chat-cache.js", () => ({
  loadCachedRuntimeProviderConfig: mockChatTurn.loadCachedRuntimeProviderConfig,
  loadCachedCoreCommsContext: mockChatTurn.loadCachedCoreCommsContext,
}));

vi.mock("./helpers.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./helpers.js")>();
  return {
    ...actual,
    loadThreadMessages: mockChatTurn.loadThreadMessages,
  };
});

vi.mock("./chat-learning-queue.js", () => ({
  enqueueCompletedChatTurnLearning: mockChatTurn.enqueueCompletedChatTurnLearning,
}));

vi.mock("./current-truth.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./current-truth.js")>();
  return {
    ...actual,
    loadTurnPlanningMemoryHints: mockChatTurn.loadTurnPlanningMemoryHints,
  };
});

vi.mock("./conversation-context.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./conversation-context.js")>();
  return {
    ...actual,
    resolveConversationContext: mockChatTurn.resolveConversationContext,
  };
});

vi.mock("./memory-retrieval.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./memory-retrieval.js")>();
  return {
    ...actual,
    loadMemoryContext: mockChatTurn.loadMemoryContext,
  };
});

const { runStreamingChatTurn } = await import("./streaming-turn.js");

describe("runStreamingChatTurn retrieval fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockChatTurn.createQueuedTurn.mockResolvedValue(chatTurnSeed());
    mockChatTurn.markTurnRetrievingContext.mockResolvedValue(undefined);
    mockChatTurn.markTurnGenerating.mockResolvedValue(undefined);
    mockChatTurn.markTurnCancelled.mockResolvedValue(undefined);
    mockChatTurn.markTurnFailed.mockResolvedValue(undefined);
    mockChatTurn.recordChatMemoryIntakeOutcome.mockResolvedValue(undefined);
    mockChatTurn.recordCompletedStreamingTurnAudit.mockResolvedValue(undefined);
    mockChatTurn.updateAssistantPartial.mockResolvedValue(undefined);
    mockChatTurn.loadCachedRuntimeProviderConfig.mockResolvedValue(runtimeConfig());
    mockChatTurn.loadCachedCoreCommsContext.mockResolvedValue({
      assistantName: "Jarvis",
      displayName: "Fortune",
      aliases: [],
      emails: [],
      phones: [],
      handles: {},
    });
    mockChatTurn.loadThreadMessages.mockResolvedValue([]);
    mockChatTurn.loadTurnPlanningMemoryHints.mockResolvedValue([]);
    mockChatTurn.resolveConversationContext.mockResolvedValue(memoryQaResolution());
    mockChatTurn.loadMemoryContext.mockResolvedValue(emptyMemoryContext());
    mockChatTurn.createOpenAICompatibleChatGenerator.mockReturnValue({
      generateChat: vi.fn(),
      streamChat: vi.fn(() => chatStream("Your name is Fortune.")),
    });
    mockChatTurn.enqueueCompletedChatTurnLearning.mockResolvedValue(undefined);
    mockChatTurn.completeStreamingTurn.mockImplementation(async (input: any) => chatMessageRow({
      id: input.assistantMessageId,
      role: "assistant",
      status: "completed",
      content: input.finalContent,
      providerKind: input.runtimeConfig.providerKind,
      model: input.model,
      metadata: { retrievalStatus: input.retrievalStatus },
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("completes with a deterministic fallback when required memory retrieval times out", async () => {
    mockChatTurn.loadMemoryContext.mockRejectedValue(new Error("memory retrieval timed out"));
    const events: Array<{ event: string; data: string }> = [];

    await runStreamingChatTurn({
      c: {} as any,
      deps: {
        db: {} as any,
        privateMemoryReader: {} as any,
        privateMemoryStorage: undefined,
        artifactProcessingQueue: undefined,
        llmFetch: vi.fn() as any,
        memorySearchConfig: {} as any,
      },
      gate: {
        twinId: "twin-1",
        thread: chatThreadRow(),
      },
      stream: {
        writeSSE: vi.fn(async (event) => {
          events.push(event);
        }),
      },
      content: "What did I tell you about the launch checklist?",
      memoryIntent: "auto",
      surface: "web_chat",
      retryAttempt: 0,
      abortController: new AbortController(),
    });

    expect(events.map((event) => event.event)).toEqual([
      "turn.created",
      "context.ready",
      "assistant.delta",
      "assistant.completed",
    ]);
    expect(mockChatTurn.markTurnFailed).not.toHaveBeenCalled();
    expect(mockChatTurn.completeStreamingTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        finalContent: "I couldn’t retrieve that memory right now, so I can’t answer it safely.",
        retrievalStatus: expect.objectContaining({
          state: "degraded",
          target: "memory",
          reason: "timeout",
        }),
      }),
    );

    const contextReady = parseEventData(events[1]);
    const assistantDelta = parseEventData(events[2]);
    const assistantCompleted = parseEventData(events[3]);
    expect(contextReady.retrievalStatus).toMatchObject({
      state: "degraded",
      target: "memory",
      reason: "timeout",
      message: "I couldn’t retrieve that memory right now, so I can’t answer it safely.",
    });
    expect(assistantDelta.delta).toBe("I couldn’t retrieve that memory right now, so I can’t answer it safely.");
    expect(assistantCompleted.context.retrievalStatus).toMatchObject({
      state: "degraded",
      target: "memory",
      reason: "timeout",
    });
  });

  it("does not use the missing-memory fallback when core comms can answer the identity question", async () => {
    mockChatTurn.resolveConversationContext.mockResolvedValue({
      ...memoryQaResolution(),
      standaloneQuery: "What is my name?",
    });
    const events: Array<{ event: string; data: string }> = [];

    await runStreamingChatTurn({
      c: {} as any,
      deps: {
        db: {} as any,
        privateMemoryReader: {} as any,
        privateMemoryStorage: undefined,
        artifactProcessingQueue: undefined,
        llmFetch: vi.fn() as any,
        memorySearchConfig: {} as any,
      },
      gate: {
        twinId: "twin-1",
        thread: chatThreadRow(),
      },
      stream: {
        writeSSE: vi.fn(async (event) => {
          events.push(event);
        }),
      },
      content: "What is my name?",
      memoryIntent: "auto",
      surface: "web_chat",
      retryAttempt: 0,
      abortController: new AbortController(),
    });

    expect(mockChatTurn.loadMemoryContext).not.toHaveBeenCalled();
    expect(mockChatTurn.createOpenAICompatibleChatGenerator).not.toHaveBeenCalled();
    expect(mockChatTurn.markTurnGenerating).not.toHaveBeenCalled();
    expect(mockChatTurn.completeStreamingTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        finalContent: "Your name is Fortune.",
        memoryContext: expect.objectContaining({ results: [] }),
      }),
    );
    expect(events.map((event) => event.event)).toEqual([
      "turn.created",
      "context.ready",
      "assistant.delta",
      "assistant.completed",
    ]);
    expect(parseEventData(events[2]).delta).toBe("Your name is Fortune.");
    expect(parseEventData(events[3]).assistantMessage.content).toBe("Your name is Fortune.");
  });

  it("passes empty memory QA context to the model instead of using the missing-memory fallback", async () => {
    mockChatTurn.resolveConversationContext.mockResolvedValue({
      ...memoryQaResolution(),
      standaloneQuery: "What is my private test phrase?",
    });
    mockChatTurn.createOpenAICompatibleChatGenerator.mockReturnValue({
      generateChat: vi.fn(),
      streamChat: vi.fn(() => chatStream("I searched your saved memory and did not find that phrase yet.")),
    });
    const events: Array<{ event: string; data: string }> = [];

    await runStreamingChatTurn({
      c: {} as any,
      deps: {
        db: {} as any,
        privateMemoryReader: {} as any,
        privateMemoryStorage: undefined,
        artifactProcessingQueue: undefined,
        llmFetch: vi.fn() as any,
        memorySearchConfig: {} as any,
      },
      gate: {
        twinId: "twin-1",
        thread: chatThreadRow(),
      },
      stream: {
        writeSSE: vi.fn(async (event) => {
          events.push(event);
        }),
      },
      content: "What is my private test phrase?",
      memoryIntent: "auto",
      surface: "web_chat",
      retryAttempt: 0,
      abortController: new AbortController(),
    });

    expect(mockChatTurn.loadMemoryContext).toHaveBeenCalled();
    expect(mockChatTurn.markTurnGenerating).toHaveBeenCalled();
    expect(mockChatTurn.createOpenAICompatibleChatGenerator).toHaveBeenCalled();
    expect(mockChatTurn.completeStreamingTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        finalContent: "I searched your saved memory and did not find that phrase yet.",
        memoryContext: expect.objectContaining({ results: [] }),
      }),
    );
    expect(events.map((event) => event.event)).toEqual([
      "turn.created",
      "context.ready",
      "assistant.delta",
      "assistant.completed",
    ]);
    expect(parseEventData(events[2]).delta).toBe(
      "I searched your saved memory and did not find that phrase yet.",
    );
    expect(parseEventData(events[3]).assistantMessage.content).toBe(
      "I searched your saved memory and did not find that phrase yet.",
    );
  });
});

function runtimeConfig(): ChatRuntimeConfig {
  return {
    id: "provider-1",
    providerKind: "openai",
    displayName: "OpenAI",
    baseUrl: "https://example.com/v1",
    model: "gpt-test",
    apiKey: "test-key",
    source: "user",
  };
}

function memoryQaResolution(): ConversationContextResolution {
  return {
    source: "llm",
    standaloneQuery: "What did I tell you about the launch checklist?",
    intent: "memory_qa",
    turnKind: "question",
    answerTarget: "memory",
    memoryWrite: "skip",
    retrieval: "hot_memory",
    confidence: 0.9,
    referencedMessageIds: [],
    memoryRequest: {
      kind: "specific_fact",
      query: "What did I tell you about the launch checklist?",
      scope: "profile",
      searchTerms: ["launch", "checklist"],
    },
  };
}

function chatTurnSeed(): ChatTurnSeed {
  return {
    turn: chatTurnRow(),
    userMessage: chatMessageRow({
      id: "user-message-1",
      role: "user",
      content: "What did I tell you about the launch checklist?",
      status: "completed",
    }),
    assistantMessage: chatMessageRow({
      id: "assistant-message-1",
      role: "assistant",
      content: "",
      status: "pending",
    }),
  } as ChatTurnSeed;
}

function emptyMemoryContext() {
  return {
    results: [],
    tokenAccountingByMemoryId: new Map(),
  };
}

function chatStream(content: string) {
  async function* textStream() {
    yield content;
  }

  return {
    textStream: textStream(),
    result: Promise.resolve({
      content,
      provider: "openai",
      model: "gpt-test",
      metadata: { usage: {} },
    }),
  };
}

function chatThreadRow() {
  const now = new Date();
  return {
    id: "thread-1",
    twinId: "twin-1",
    title: "Test chat",
    titleSource: "manual",
    llmProviderConfigId: null,
    metadata: {},
    createdAt: now,
    updatedAt: now,
  } as any;
}

function chatTurnRow() {
  const now = new Date();
  return {
    id: "turn-1",
    twinId: "twin-1",
    threadId: "thread-1",
    userMessageId: "user-message-1",
    assistantMessageId: "assistant-message-1",
    status: "queued",
    providerKind: null,
    model: null,
    errorCode: null,
    errorMessage: null,
    startedAt: now,
    completedAt: null,
    cancelledAt: null,
    metadata: {},
    createdAt: now,
    updatedAt: now,
  } as any;
}

function chatMessageRow(input: {
  id: string;
  role: "user" | "assistant";
  content: string;
  status: "pending" | "completed" | "failed";
  providerKind?: string | null;
  model?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const now = new Date();
  return {
    id: input.id,
    twinId: "twin-1",
    threadId: "thread-1",
    turnId: "turn-1",
    role: input.role,
    status: input.status,
    content: input.content,
    providerKind: input.providerKind ?? null,
    model: input.model ?? null,
    memoryFragmentIds: [],
    citations: [],
    usage: {},
    metadata: input.metadata ?? {},
    createdAt: now,
  } as any;
}

function parseEventData(event: { data: string }) {
  return JSON.parse(event.data) as any;
}
