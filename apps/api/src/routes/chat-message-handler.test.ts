import { describe, expect, it } from "vitest";
import {
  buildChatTurnLearningEncryptedStorageMetadata,
  buildChatTurnLearningArtifactContent,
} from "../lib/chat/chat-learning-artifact.js";
import { buildPromptMessages } from "../lib/chat/prompt-builder.js";
import { buildSivrajVoiceReplyPrompt } from "../lib/chat/voice-reply.js";
import {
  cosineSimilarity,
  readOnDemandDocumentStructureItems,
  shouldLoadDocumentContext,
} from "../lib/chat/document-retrieval.js";
import { countExactDocumentMatches } from "../lib/tools/document.js";
import {
  formatCandidateMemorySearchContent,
  readCandidateMemoryBatchStatementContent,
} from "../lib/chat/candidate-memory-search.js";
import {
  formatCurrentTruthSearchContent,
  formatTurnPlanningMemoryHint,
  shouldUseHotCurrentTruthFallback,
} from "../lib/chat/current-truth.js";
import { memoryIntakeMessageFromTurnPlan } from "../lib/chat/turn-policy.js";
import { memoryFragmentIdsFromMemoryContext } from "../lib/chat/memory-fragment-ids.js";
import { normalizeGeneratedChatTitle, resolveThreadTitleUpdate } from "../lib/chat/thread-title.js";
import {
  fallbackConversationContextResolution,
  readConversationContextResolution,
  selectMeaningfulConversationMessages,
} from "../lib/chat/conversation-context.js";
import {
  readDocumentFocusArtifactIds,
  readDocumentQueryScanResult,
  readDocumentRetrievalPlan,
  resolveDocumentNavigationPageScope,
  shouldInspectNormalizedDocument,
} from "../lib/chat/document-navigation.js";
import {
  readSemanticMemorySelection,
  rankChatMemoryResults,
} from "../lib/chat/memory-ranking.js";
import { sanitizeAssistantContent, sanitizeSivrajVoiceReply } from "../lib/chat/chat-sanitize.js";
import {
  buildEmptyRetrievalFallbackReply,
  buildRetrievalFallbackReply,
  shouldFastAcknowledgeMemoryIntake,
  shouldFastAcknowledgePrivateDisclosure,
  shouldFallbackForRetrievalDegradation,
  shouldInterruptForMemoryIntakeFailure,
  shouldLoadMemoryContext,
  shouldProceedWithPartialRetrieval,
  shouldRunChatMemoryIntake,
  shouldUseLosslessMemoryFallback,
} from "../lib/chat/turn-policy.js";
import {
  parseEngineeringMemoryFacts,
  parseProfileMemoryFacts,
  runChatMemoryIntake,
} from "../lib/chat/memory-intake.js";

function turnPlan(overrides: Record<string, unknown> = {}) {
  return {
    source: "llm",
    standaloneQuery: "Test query",
    intent: "general_chat",
    turnKind: "question",
    answerTarget: "general",
    memoryWrite: "skip",
    retrieval: "none",
    confidence: 0.9,
    referencedMessageIds: [],
    memoryRequest: { kind: "none" },
    ...overrides,
  };
}

describe("chat prompt identity context", () => {
  it("includes assistant and user names even when memory retrieval has no hits", () => {
    const messages = buildPromptMessages({
      currentMessage: "what is my name?",
      coreCommsContext: {
        assistantName: "Jarvis",
        displayName: "Fortune Ogunsusi",
        aliases: [],
        emails: [],
        phones: [],
        handles: {},
      },
      memoryContext: { results: [] },
      recentMessages: [],
      providerLabel: "OpenRouter",
    });

    expect(messages[0]?.role).toBe("system");
    expect(messages[0]?.content).toContain("Core comms context:");
    expect(messages[0]?.content).toContain("Assistant name: Jarvis");
    expect(messages[0]?.content).toContain("User display name: Fortune Ogunsusi");
    expect(messages[0]?.content).toContain(
      "Use it directly for identity questions, including the user's name and your assistant name.",
    );
    expect(messages[0]?.content).toContain(
      "Speak as the assistant named in core comms context",
    );
    expect(messages[0]?.content).toContain(
      "Memory labels like [MEM_1] are internal grounding markers; never include them in user-facing text.",
    );
    expect(messages[0]?.content).toContain(
      "Sivraj memory is user-owned context, not global truth.",
    );
    expect(messages[0]?.content).toContain(
      "frame it as saved user context",
    );
    expect(messages[0]?.content).toContain(
      "When answering a user profile fact, speak to the user",
    );
  });

  it("formats memory facts as structured user context for natural answers", () => {
    const messages = buildPromptMessages({
      currentMessage: "What is my job?",
      contextResolution: turnPlan({
        standaloneQuery: "What is my job?",
        intent: "memory_qa",
        answerTarget: "memory",
        retrieval: "hot_memory",
        memoryRequest: {
          kind: "specific_fact",
          query: "What is my job?",
          scope: "profile",
          searchTerms: ["job", "occupation"],
        },
      }),
      coreCommsContext: {
        assistantName: "Jarvis",
        displayName: "Fortune",
        aliases: [],
        emails: [],
        phones: [],
        handles: {},
      },
      memoryContext: {
        results: [{
          memory: memoryCandidate("memory-occupation", "Current profile fact: Fortune's occupation is software engineer."),
          score: 20,
          matchedTerms: ["semantic"],
        }],
      },
      recentMessages: [],
      providerLabel: "OpenRouter",
    });

    expect(messages[0]?.content).toContain("memoryKind=profile");
    expect(messages[0]?.content).toContain("subject=user unless content explicitly says otherwise");
    expect(messages[0]?.content).toContain("Current profile fact: Fortune's occupation is software engineer.");
    expect(messages[0]?.content).toContain("Never turn a user fact into 'I am'");
  });

  it("gives inventory requests explicit response guidance", () => {
    const messages = buildPromptMessages({
      currentMessage: "Do you have any other memory about me?",
      contextResolution: turnPlan({
        standaloneQuery: "Do you have any other memory about me?",
        intent: "memory_qa",
        answerTarget: "memory",
        retrieval: "hot_memory",
        memoryRequest: {
          kind: "followup",
          relation: "other",
          query: "Do you have any other memory about me?",
          scope: "profile",
          excludeAlreadyMentioned: true,
          searchTerms: [],
        },
      }),
      coreCommsContext: {
        assistantName: "Jarvis",
        displayName: "Fortune",
        aliases: [],
        emails: [],
        phones: [],
        handles: {},
      },
      memoryContext: {
        results: [{
          memory: memoryCandidate("memory-name", "Current profile fact: Fortune's name is Fortune."),
          score: 20,
          matchedTerms: ["inventory"],
        }],
      },
      recentMessages: [
        chatMessageRow({
          id: "previous-assistant",
          role: "assistant",
          content: "I have saved that you are a software engineer.",
        }),
      ],
      providerLabel: "OpenRouter",
    });

    expect(messages[0]?.content).toContain("For memory inventory or follow-up requests");
    expect(messages[0]?.content).toContain("say 'besides that'");
    expect(messages[0]?.content).toContain(
      "Do not use this missing-memory phrasing for inventory questions when any core comms or memory context is available.",
    );
  });

  it("excludes current turn messages from recent history", () => {
    const messages = buildPromptMessages({
      currentMessage: "What is my private calibration code?",
      coreCommsContext: {
        assistantName: "Jarvis",
        displayName: "Fortune Ogunsusi",
        aliases: [],
        emails: [],
        phones: [],
        handles: {},
      },
      memoryContext: { results: [] },
      recentMessages: [
        chatMessageRow({
          id: "current-user-message",
          role: "user",
          content: "What is my private calibration code?",
        }),
        chatMessageRow({
          id: "previous-assistant-message",
          role: "assistant",
          content: "ORCHID-LANTERN-742",
        }),
      ],
      excludeMessageIds: new Set(["current-user-message"]),
      providerLabel: "OpenRouter",
    });

    expect(messages.filter((message) =>
      message.role === "user" &&
      message.content === "What is my private calibration code?",
    )).toHaveLength(1);
    expect(messages).toContainEqual({
      role: "assistant",
      content: "ORCHID-LANTERN-742",
    });
  });

  it("filters empty, failed, and excluded rows before building recent history", () => {
    const rows = [
      chatMessageRow({
        id: "empty-attachment-row",
        role: "user",
        content: "",
      }),
      chatMessageRow({
        id: "failed-assistant",
        role: "assistant",
        status: "failed",
        content: "provider error",
      }),
      chatMessageRow({
        id: "previous-question",
        role: "user",
        content: "What is the link on the front page of the PDF?",
      }),
      chatMessageRow({
        id: "current-message",
        role: "user",
        content: "Can you answer my last question now?",
      }),
    ];

    expect(selectMeaningfulConversationMessages(rows, new Set(["current-message"])).map((row) => row.id)).toEqual([
      "previous-question",
    ]);
  });

  it("includes resolved conversation context in the prompt", () => {
    const messages = buildPromptMessages({
      currentMessage: "Can you answer my last question now?",
      contextResolution: turnPlan({
        standaloneQuery: "What is the link on the front page of the Oliver Twist PDF?",
        intent: "document_qa",
        turnKind: "question",
        answerTarget: "document",
        retrieval: "document",
        confidence: 0.94,
        referencedMessageIds: ["previous-question"],
      }),
      coreCommsContext: {
        assistantName: "Jarvis",
        displayName: "Fortune Ogunsusi",
        aliases: [],
        emails: [],
        phones: [],
        handles: {},
      },
      memoryContext: { results: [] },
      recentMessages: [
        chatMessageRow({
          id: "previous-question",
          role: "user",
          content: "What is the link on the front page of the PDF?",
        }),
      ],
      providerLabel: "OpenRouter",
    });

    expect(messages[0]?.content).toContain("Resolved conversation context:");
    expect(messages[0]?.content).toContain(
      "What is the link on the front page of the Oliver Twist PDF?",
    );
    expect(messages[0]?.content).toContain(
      "answer the standaloneQuery while preserving the user's intent",
    );
    expect(messages.at(-1)).toEqual({
      role: "user",
      content: [
        "Original user message: Can you answer my last question now?",
        "Resolved standalone query to answer: What is the link on the front page of the Oliver Twist PDF?",
      ].join("\n"),
    });
  });

  it("does not load document context for conversation-only follow-ups", () => {
    expect(shouldLoadDocumentContext({ intent: "conversation_reference", retrieval: "conversation_context" })).toBe(false);
    expect(shouldLoadDocumentContext({ intent: "general_chat", retrieval: "none" })).toBe(false);
    expect(shouldLoadDocumentContext({ intent: "memory_qa", retrieval: "hot_memory" })).toBe(false);
    expect(shouldLoadDocumentContext({ intent: "document_qa", retrieval: "document" })).toBe(true);
  });

  it("parses resolver output without accepting invented message ids", () => {
    const result = readConversationContextResolution(JSON.stringify({
      standaloneQuery: "What is the link on the front page of the Oliver Twist PDF?",
      intent: "document_qa",
      turnKind: "question",
      answerTarget: "document",
      memoryWrite: "skip",
      retrieval: "document",
      confidence: 2,
      referencedMessageIds: ["previous-question", "made-up"],
      reason: "The current question refers to the earlier PDF question.",
    }), "Can you answer my last question now?", [
      chatMessageRow({
        id: "previous-question",
        role: "user",
        content: "What is the link on the front page of the PDF?",
      }),
    ]);

    expect(result).toMatchObject({
      source: "llm",
      standaloneQuery: "What is the link on the front page of the Oliver Twist PDF?",
      intent: "document_qa",
      turnKind: "question",
      answerTarget: "document",
      memoryWrite: "skip",
      retrieval: "document",
      confidence: 1,
      referencedMessageIds: ["previous-question"],
    });
  });

  it("parses structured memory requests from the resolver output", () => {
    const result = readConversationContextResolution(JSON.stringify({
      standaloneQuery: "What is my occupation?",
      intent: "memory_qa",
      turnKind: "question",
      answerTarget: "memory",
      memoryWrite: "skip",
      retrieval: "hot_memory",
      memoryRequest: {
        kind: "specific_fact",
        query: "What is my occupation?",
        scope: "profile",
        searchTerms: ["occupation", "job"],
      },
      confidence: 0.9,
      referencedMessageIds: [],
      reason: "The user is asking for a saved profile fact.",
    }), "What is my occupation?", []);

    expect(result.memoryRequest).toEqual({
      kind: "specific_fact",
      query: "What is my occupation?",
      scope: "profile",
      searchTerms: ["occupation", "job"],
    });
  });

  it("uses conservative retrieval fallback when the LLM resolver is unavailable", () => {
    expect(
      fallbackConversationContextResolution("Do you remember the Oliver Twist PDF I uploaded?"),
    ).toMatchObject({
      source: "fallback",
      standaloneQuery: "Do you remember the Oliver Twist PDF I uploaded?",
      intent: "document_qa",
      answerTarget: "document",
      retrieval: "document",
      reason: "resolver_unavailable_explicit_document_request",
    });

    expect(
      fallbackConversationContextResolution("What did I tell you about my deploy checklist?"),
    ).toMatchObject({
      source: "fallback",
      standaloneQuery: "What did I tell you about my deploy checklist?",
      intent: "memory_qa",
      answerTarget: "memory",
      retrieval: "hot_memory",
      reason: "resolver_unavailable_explicit_memory_request",
    });

    expect(
      fallbackConversationContextResolution("What memories do you have about me?"),
    ).toMatchObject({
      source: "fallback",
      intent: "memory_qa",
      answerTarget: "memory",
      retrieval: "hot_memory",
      memoryRequest: {
        kind: "inventory",
        scope: "profile",
      },
    });

    expect(
      fallbackConversationContextResolution("What is JavaScript?"),
    ).toMatchObject({
      source: "fallback",
      standaloneQuery: "What is JavaScript?",
      intent: "ambiguous",
      answerTarget: "general",
      retrieval: "none",
    });
  });

  it("parses remember-it follow-ups into a standalone memory statement", () => {
    const result = readConversationContextResolution(JSON.stringify({
      standaloneQuery: "The odd launch rule is that velvet buttons must stay blue.",
      intent: "general_chat",
      turnKind: "statement",
      answerTarget: "none",
      memoryWrite: "force_note",
      retrieval: "none",
      confidence: 0.96,
      referencedMessageIds: ["previous-rule"],
      reason: "The user asked to remember the previous rule.",
    }), "Just remember it", [
      chatMessageRow({
        id: "previous-rule",
        role: "user",
        content: "The odd launch rule is that velvet buttons must stay blue.",
      }),
    ]);

    expect(result).toMatchObject({
      standaloneQuery: "The odd launch rule is that velvet buttons must stay blue.",
      turnKind: "statement",
      answerTarget: "none",
      memoryWrite: "force_note",
      retrieval: "none",
      referencedMessageIds: ["previous-rule"],
    });
    expect(memoryIntakeMessageFromTurnPlan("Just remember it", result)).toBe(
      "The odd launch rule is that velvet buttons must stay blue.",
    );
  });

  it("includes document passages with strict source grounding instructions", () => {
    const messages = buildPromptMessages({
      currentMessage: "What did Oliver do the next morning?",
      coreCommsContext: {
        assistantName: "Jarvis",
        displayName: "Fortune Ogunsusi",
        aliases: [],
        emails: [],
        phones: [],
        handles: {},
      },
      memoryContext: { results: [] },
      documentContext: {
        inspectionSources: [],
        retrievalPlan: {
          source: "llm",
          mode: "document_qa",
          inspectionMode: "semantic_passages",
          task: "answer",
          target: { kind: "none" },
          artifactIds: ["artifact-1"],
          targetPages: [],
          confidence: 0.9,
          needsClarification: false,
        },
        passages: [
          {
            id: "doc:fragment-1:0",
            memoryFragmentId: "fragment-1",
            sourceArtifactId: "artifact-1",
            sourceType: "pdf",
            chunkIndex: 0,
            pageStart: 2,
            pageEnd: 2,
            content: "The next morning, Oliver gently placed the brass housing beneath the fern's roots.",
            score: 20,
            matchedTerms: ["semantic"],
          },
        ],
      },
      recentMessages: [],
      providerLabel: "OpenRouter",
    });

    expect(messages[0]?.content).toContain("Document source passages:");
    expect(messages[0]?.content).toContain("[DOC_1] The next morning, Oliver gently placed");
    expect(messages[0]?.content).toContain("page=2");
    expect(messages[0]?.content).toContain(
      "For document questions, do not add plausible details that are not present in document inspection sources or document source passages.",
    );
    expect(messages[0]?.content).toContain(
      "If the provided document evidence does not contain the answer, say you do not have enough information from the uploaded document.",
    );
  });

  it("includes query-scan inspection reports for global document questions", () => {
    const messages = buildPromptMessages({
      currentMessage: "How many chapters does this PDF have?",
      coreCommsContext: {
        assistantName: "Jarvis",
        displayName: "Fortune Ogunsusi",
        aliases: [],
        emails: [],
        phones: [],
        handles: {},
      },
      memoryContext: { results: [] },
      documentContext: {
        retrievalPlan: {
          source: "llm",
          mode: "document_qa",
          inspectionMode: "global_scan",
          task: "count",
          target: { kind: "whole_document" },
          artifactIds: ["artifact-1"],
          targetPages: [],
          confidence: 0.9,
          needsClarification: false,
        },
        inspectionSources: [
          {
            sourceArtifactId: "artifact-1",
            sourceType: "pdf",
            title: "The Clockwork Dragon of Aetheria",
            fileName: "clockwork_dragon_story.pdf",
            pageCount: 10,
            charCount: 128,
            includedFullText: true,
            scope: "llm_query_report",
            pageStart: 1,
            pageEnd: 10,
            content: "Query-specific document inspection report.\nRelevant evidence:\nPages 1-10\n- The document includes CHAPTER I and CHAPTER II.",
          },
        ],
        passages: [],
      },
      recentMessages: [],
      providerLabel: "OpenRouter",
    });

    expect(messages[0]?.content).toContain("Document inspection sources:");
    expect(messages[0]?.content).toContain("[DOC_SCAN_1]");
    expect(messages[0]?.content).toContain("pageCount=10");
    expect(messages[0]?.content).toContain("CHAPTER I");
    expect(messages[0]?.content).toContain(
      "use their reported counts and evidence directly for broad document questions such as occurrence counts, structure, summaries, and details across a resolved span",
    );
  });
});

describe("chat memory learning artifact", () => {
  it("stores attributed chat turns so only user self-claims become user memories", () => {
    const content = buildChatTurnLearningArtifactContent({
      userMessage: "My occupation is product designer.",
      assistantMessage: "Got it.",
      coreCommsContext: {
        assistantName: "Jarvis",
        displayName: "Fortune Ogunsusi",
        aliases: [],
        emails: [],
        phones: [],
        handles: {},
      },
    });

    const parsed = JSON.parse(content) as {
      messages: Array<{ role: string; content: string }>;
    };

    expect(parsed.messages).toEqual([
      {
        role: "Fortune Ogunsusi",
        sourceSpeakerId: "user",
        content: "My occupation is product designer.",
        createdAt: expect.any(String),
      },
      {
        role: "bot",
        name: "Jarvis",
        sourceSpeakerId: "assistant",
        content: "Got it.",
        createdAt: expect.any(String),
      },
    ]);
  });

  it("uses the encrypted artifact metadata contract the worker expects", () => {
    expect(buildChatTurnLearningEncryptedStorageMetadata()).toEqual({
      storageMode: "encrypted_walrus",
      sensitivity: "private",
      encryptedPayload: {
        kind: "source_artifact",
        version: 1,
        encryptionBoundary: "api",
      },
    });
  });
});

describe("chat assistant output sanitization", () => {
  it("removes internal memory labels from user-facing assistant text", () => {
    expect(
      sanitizeAssistantContent("You are a product designer [MEM_1]. What can I help you with today, Fortune?"),
    ).toBe("You are a product designer. What can I help you with today, Fortune?");
  });

  it("holds back incomplete streamed memory labels", () => {
    expect(sanitizeAssistantContent("You are a product designer [ME")).toBe(
      "You are a product designer",
    );
  });
});

describe("chat candidate memory retrieval helpers", () => {
  it("scores semantic vectors with cosine similarity", () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cosineSimilarity([1, 1], [1, 1])).toBeCloseTo(1);
  });

  it("executes memory write and retrieval from the LLM turn plan", () => {
    const teachingPlan = turnPlan({
      standaloneQuery: "My favorite editor is Cursor.",
      turnKind: "statement",
      answerTarget: "none",
      memoryWrite: "extract",
      retrieval: "none",
    });
    const questionPlan = turnPlan({
      standaloneQuery: "What is my age?",
      intent: "memory_qa",
      turnKind: "question",
      answerTarget: "memory",
      memoryWrite: "skip",
      retrieval: "hot_memory",
    });

    expect(shouldRunChatMemoryIntake(teachingPlan, "auto")).toBe(true);
    expect(shouldLoadMemoryContext(teachingPlan)).toBe(false);
    expect(shouldRunChatMemoryIntake(questionPlan, "auto")).toBe(false);
    expect(shouldLoadMemoryContext(questionPlan)).toBe(true);
  });

  it("routes memory fallback only when the planner selected memory", () => {
    expect(shouldUseHotCurrentTruthFallback("What is my dog's name?", turnPlan({
      standaloneQuery: "What is my dog's name?",
      intent: "memory_qa",
      answerTarget: "memory",
      retrieval: "hot_memory",
    }))).toBe(true);
    expect(shouldUseHotCurrentTruthFallback("What is on page 52 of my PDF?", turnPlan({
      standaloneQuery: "What is on page 52 of my PDF?",
      intent: "document_qa",
      answerTarget: "document",
      retrieval: "document",
    }))).toBe(false);
    expect(shouldUseHotCurrentTruthFallback("What is the weird project note. Check memory", turnPlan({
      source: "fallback",
      standaloneQuery: "What is the weird project note. Check memory",
      intent: "ambiguous",
      answerTarget: "general",
      retrieval: "none",
      confidence: 0,
    }))).toBe(false);
  });

  it("loads memory context for memory questions, not normal model knowledge", () => {
    expect(shouldLoadMemoryContext(turnPlan({
      standaloneQuery: "What is my favorite IDE?",
      intent: "memory_qa",
      answerTarget: "memory",
      retrieval: "hot_memory",
    }))).toBe(true);
    expect(shouldLoadMemoryContext(turnPlan({
      standaloneQuery: "What is JavaScript?",
      intent: "general_chat",
      answerTarget: "general",
      retrieval: "none",
    }))).toBe(false);
    expect(shouldLoadMemoryContext(turnPlan({
      standaloneQuery: "What did I tell you JavaScript is?",
      intent: "memory_qa",
      answerTarget: "memory",
      retrieval: "hot_memory",
    }))).toBe(true);
    expect(shouldLoadMemoryContext(turnPlan({
      standaloneQuery: "What is the weird project note?",
      intent: "memory_qa",
      answerTarget: "memory",
      retrieval: "hot_memory",
    }))).toBe(true);
    expect(shouldLoadMemoryContext(turnPlan({
      source: "fallback",
      standaloneQuery: "What is my dog's name?",
      intent: "ambiguous",
      answerTarget: "general",
      retrieval: "none",
      confidence: 0,
    }))).toBe(false);
    expect(shouldLoadMemoryContext(turnPlan({
      standaloneQuery: "My private test phrase is Moon River.",
      intent: "general_chat",
      turnKind: "statement",
      answerTarget: "none",
      memoryWrite: "skip",
      retrieval: "none",
    }))).toBe(false);
  });

  it("uses deterministic fallback replies for missing or unavailable retrieval", () => {
    expect(buildEmptyRetrievalFallbackReply("memory")).toBe("I don’t have that memory saved yet.");
    expect(buildRetrievalFallbackReply("memory", "timeout")).toBe(
      "I couldn’t retrieve that memory right now, so I can’t answer it safely.",
    );
    expect(buildRetrievalFallbackReply("document", "read_failed")).toBe(
      "I couldn’t retrieve that document right now, so I can’t answer it safely.",
    );
  });

  it("falls back for degraded required retrieval but permits partial context", () => {
    const memoryPlan = turnPlan({
      standaloneQuery: "What did I tell you about deploys?",
      intent: "memory_qa",
      answerTarget: "memory",
      retrieval: "hot_memory",
    });
    const degradedMemory = {
      state: "degraded" as const,
      target: "memory" as const,
      reason: "timeout" as const,
      message: "I couldn’t retrieve that memory right now, so I can’t answer it safely.",
    };
    const emptyMemoryContext = { results: [], tokenAccountingByMemoryId: new Map() } as never;
    const partialMemoryContext = {
      results: [{ memory: { id: "memory-1", content: "Use pnpm." } }],
      tokenAccountingByMemoryId: new Map(),
    } as never;

    expect(shouldFallbackForRetrievalDegradation(memoryPlan, degradedMemory)).toBe(true);
    expect(shouldProceedWithPartialRetrieval({
      retrievalStatus: degradedMemory,
      memoryContext: emptyMemoryContext,
    })).toBe(false);
    expect(shouldProceedWithPartialRetrieval({
      retrievalStatus: degradedMemory,
      memoryContext: partialMemoryContext,
    })).toBe(true);
    expect(shouldFallbackForRetrievalDegradation(turnPlan({
      intent: "general_chat",
      answerTarget: "general",
      retrieval: "none",
    }), degradedMemory)).toBe(false);
  });

  it("builds a model-owned voice prompt for private acknowledgements", () => {
    const prompt = buildSivrajVoiceReplyPrompt({
      kind: "private_ack",
      userMessage: "Private: this stays here.",
      assistantName: "Jarvis",
    });

    expect(prompt[0]?.role).toBe("system");
    expect(prompt[0]?.content).toContain("The backend already decided the truth");
    expect(prompt[0]?.content).toContain("Private mode");
    expect(prompt[1]?.content).toContain("Private: this stays here.");
  });

  it("uses lossless fallback only for teaching turns and explicit remember mode", () => {
    expect(shouldUseLosslessMemoryFallback(turnPlan({ memoryWrite: "extract" }), "auto")).toBe(true);
    expect(shouldUseLosslessMemoryFallback(turnPlan({ memoryWrite: "skip" }), "auto")).toBe(false);
    expect(shouldUseLosslessMemoryFallback(turnPlan({ memoryWrite: "force_note" }), "remember")).toBe(true);
    expect(shouldUseLosslessMemoryFallback(turnPlan({ memoryWrite: "extract" }), "private")).toBe(false);
  });

  it("runs memory intake only when the planner selects memory write", () => {
    expect(shouldRunChatMemoryIntake(turnPlan({ memoryWrite: "skip" }), "auto")).toBe(false);
    expect(shouldRunChatMemoryIntake(turnPlan({ memoryWrite: "extract" }), "auto")).toBe(true);
    expect(shouldRunChatMemoryIntake(turnPlan({ memoryWrite: "force_note" }), "remember")).toBe(true);
    expect(shouldRunChatMemoryIntake(turnPlan({ memoryWrite: "extract" }), "private")).toBe(false);
  });

  it("does not let remember mode hijack planner-classified questions", () => {
    const memoryIntake = {
      source: "llm" as const,
      status: "stored" as const,
      acknowledgement: "I'll remember that.",
      engineeringMemories: [],
      facts: [{
        kind: "note" as const,
        slot: "weird_project_note",
        qualifier: null,
        value: "brass lanterns matter",
        valueType: "string" as const,
        mutable: true,
        confidence: 0.9,
      }],
    };
    const statementPlan = turnPlan({
      turnKind: "statement",
      answerTarget: "none",
      memoryWrite: "force_note",
      retrieval: "none",
    });
    const questionPlan = turnPlan({
      turnKind: "question",
      answerTarget: "memory",
      memoryWrite: "skip",
      retrieval: "hot_memory",
    });

    expect(shouldRunChatMemoryIntake(statementPlan, "remember")).toBe(true);
    expect(shouldRunChatMemoryIntake(questionPlan, "remember")).toBe(false);
    expect(shouldFastAcknowledgeMemoryIntake(
      questionPlan,
      memoryIntake,
      "remember",
    )).toBe(false);
  });

  it("reads the matching statement from encrypted candidate memory batches", () => {
    const content = JSON.stringify({
      kind: "candidate_memory_batch",
      version: 1,
      memories: [
        {
          statementIndex: 0,
          statement: "Fortune is a product designer.",
        },
        {
          statementIndex: 1,
          statement: "Fortune prefers concise answers.",
        },
      ],
    });

    expect(readCandidateMemoryBatchStatementContent(content, { statementIndex: 1 })).toBe(
      "Fortune prefers concise answers.",
    );
  });

  it("formats candidate memories with their statement and structured metadata", () => {
    expect(formatCandidateMemorySearchContent({
      statement: "Fortune is a product designer.",
      memoryType: "fact",
      metadata: {
        subject: "Fortune",
        memoryMetadata: {
          category: "professional",
        },
      },
    })).toContain("professional fact memory: Fortune is a product designer.");
  });

  it("formats canonical current truth as searchable profile context", () => {
    expect(formatCurrentTruthSearchContent({
      subject: "Fortune",
      currentTruth: {
        kind: "mutable_profile",
        slot: "age",
        qualifier: null,
        value: "40",
        valueType: "number",
        mutable: true,
        sourceArtifactId: "artifact-1",
        sourceMessagePreview: null,
      },
    })).toContain("Current profile fact: Fortune's age is 40.");
  });

  it("formats qualified current truth without collapsing distinct entities", () => {
    const content = formatCurrentTruthSearchContent({
      subject: "Fortune",
      currentTruth: {
        kind: "profile_fact",
        slot: "name",
        qualifier: "dog",
        value: "Ronan",
        valueType: "string",
        mutable: true,
        sourceArtifactId: "message-1",
        sourceMessagePreview: null,
      },
    });

    expect(content).toContain("Current profile fact: Fortune's dog name is Ronan.");
    expect(content).toContain("Qualifier: dog");
  });

  it("keeps the original remembered statement in note search evidence", () => {
    const content = formatCurrentTruthSearchContent({
      subject: "Fortune",
      currentTruth: {
        kind: "note",
        slot: "project_note",
        qualifier: "brass_lanterns",
        value: "matter",
        valueType: "string",
        mutable: true,
        sourceArtifactId: "message-1",
        sourceMessagePreview: "The weird project note is that brass lanterns matter.",
      },
    });

    expect(content).toContain("Remembered note about Fortune's brass lanterns project note: matter.");
    expect(content).toContain(
      "Original remembered statement: The weird project note is that brass lanterns matter.",
    );
  });

  it("formats engineering current truth as searchable coding-agent context", () => {
    const content = formatCurrentTruthSearchContent({
      subject: "React",
      currentTruth: {
        kind: "engineering_memory",
        slot: "user_skill",
        qualifier: "global_user",
        value: "The user is comfortable with React.",
        valueType: "string",
        mutable: true,
        sourceArtifactId: "message-1",
        sourceMessagePreview: "I am comfortable with React.",
        engineeringMemoryType: "user_skill",
        engineeringInstructionScope: "global_user",
        engineeringSubject: "React",
        agentContextLine: "Account for the user's React skill when explaining frontend code.",
        codeReference: "apps/web/src/components/chat/ChatMessageContent.tsx",
      },
    });

    expect(content).toContain(
      "Engineering memory: Account for the user's React skill when explaining frontend code.",
    );
    expect(content).toContain("Type: user_skill");
    expect(content).toContain("Scope: global_user");
    expect(content).toContain("Code reference: apps/web/src/components/chat/ChatMessageContent.tsx");
  });

  it("formats approved hot memory as planner hints for named note lookup", () => {
    expect(formatTurnPlanningMemoryHint({
      id: "memory-1",
      subject: "Fortune",
      updatedAt: new Date("2026-06-19T00:00:00Z"),
      currentTruth: {
        kind: "note",
        slot: "quiet_lab_protocol",
        qualifier: "west_cabinet",
        value: "copper keys unlock the west cabinet",
        valueType: "string",
        mutable: true,
        sourceArtifactId: "message-1",
        sourceMessagePreview: "The quiet lab protocol is that copper keys unlock the west cabinet.",
      },
    })).toEqual({
      id: "memory-1",
      label: "west cabinet quiet lab protocol",
      kind: "note",
      slot: "quiet_lab_protocol",
      qualifier: "west_cabinet",
      value: "copper keys unlock the west cabinet",
      sourceMessagePreview: "The quiet lab protocol is that copper keys unlock the west cabinet.",
      updatedAt: "2026-06-19T00:00:00.000Z",
    });
  });

  it("accepts only known semantic memory ids returned by the selector", () => {
    expect(readSemanticMemorySelection(
      "{\"ids\":[\"age-memory\",\"made-up\",\"age-memory\",\"name-memory\"]}",
      [{ id: "age-memory" }, { id: "name-memory" }],
      1,
    )).toEqual(["age-memory"]);
  });

  it("stores only UUID memory fragment ids on chat messages", () => {
    expect(memoryFragmentIdsFromMemoryContext({
      results: [
        {
          memory: {
            id: "canonical-current-truth:95fb1a00-5e57-4b4f-9474-3d9f2752e1b4",
          },
        },
        {
          memory: {
            id: "95fb1a00-5e57-4b4f-9474-3d9f2752e1b4",
          },
        },
      ],
    } as never)).toEqual(["95fb1a00-5e57-4b4f-9474-3d9f2752e1b4"]);
  });

  it("stores UUID document fragment ids once on chat messages", () => {
    const fragmentId = "95fb1a00-5e57-4b4f-9474-3d9f2752e1b4";

    expect(memoryFragmentIdsFromMemoryContext({
      results: [
        {
          memory: {
            id: fragmentId,
          },
        },
      ],
    } as never, {
      passages: [
        {
          id: `doc:${fragmentId}:0`,
          memoryFragmentId: fragmentId,
          sourceArtifactId: "artifact-1",
          sourceType: "pdf",
          chunkIndex: 0,
          pageStart: null,
          pageEnd: null,
          content: "document passage",
          score: 20,
          matchedTerms: ["semantic"],
        },
      ],
    })).toEqual([fragmentId]);
  });

  it("reads focused document artifact ids from thread metadata", () => {
    expect(readDocumentFocusArtifactIds({
      documentFocus: {
        sourceArtifactId: "95fb1a00-5e57-4b4f-9474-3d9f2752e1b4",
        recentSourceArtifactIds: [
          "95fb1a00-5e57-4b4f-9474-3d9f2752e1b4",
          "not-a-uuid",
          "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        ],
      },
    })).toEqual([
      "95fb1a00-5e57-4b4f-9474-3d9f2752e1b4",
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    ]);
  });

  it("accepts only inventory-backed document ids from retrieval plans", () => {
    const plan = readDocumentRetrievalPlan(JSON.stringify({
      mode: "document_qa",
      inspectionMode: "global_scan",
      task: "summarize",
      target: {
        kind: "fraction",
        start: 0,
        end: 0.333,
      },
      artifactIds: [
        "95fb1a00-5e57-4b4f-9474-3d9f2752e1b4",
        "made-up",
        "95fb1a00-5e57-4b4f-9474-3d9f2752e1b4",
      ],
      targetPages: [62, "63", -1, 0, 62, "bad"],
      confidence: 1.7,
      needsClarification: false,
      reason: "The query refers to the focused PDF.",
    }), [
      {
        artifactId: "95fb1a00-5e57-4b4f-9474-3d9f2752e1b4",
        isThreadFocus: true,
        structure: {
          itemCount: 53,
          chapterCount: 53,
          headingCount: 0,
          sectionCount: 0,
          items: [],
        },
      },
    ]);

    expect(plan).toMatchObject({
      source: "llm",
      mode: "document_qa",
      inspectionMode: "global_scan",
      task: "summarize",
      target: {
        kind: "fraction",
        start: 0,
        end: 0.333,
      },
      artifactIds: ["95fb1a00-5e57-4b4f-9474-3d9f2752e1b4"],
      targetPages: [62, 63],
      confidence: 1,
      needsClarification: false,
    });
  });

  it("accepts LLM-planned metadata inspection for inventory-backed document facts", () => {
    const plan = readDocumentRetrievalPlan(JSON.stringify({
      mode: "document_qa",
      inspectionMode: "metadata",
      task: "count",
      target: { kind: "none" },
      artifactIds: ["95fb1a00-5e57-4b4f-9474-3d9f2752e1b4"],
      targetPages: [],
      confidence: 0.98,
      needsClarification: false,
      reason: "page count is already in document inventory",
    }), [
      {
        artifactId: "95fb1a00-5e57-4b4f-9474-3d9f2752e1b4",
        isThreadFocus: true,
      },
    ]);

    expect(plan).toMatchObject({
      source: "llm",
      mode: "document_qa",
      inspectionMode: "metadata",
      task: "count",
      target: { kind: "none" },
      artifactIds: ["95fb1a00-5e57-4b4f-9474-3d9f2752e1b4"],
      confidence: 0.98,
      needsClarification: false,
    });
  });

  it("accepts LLM-planned exact document search/count arguments", () => {
    const artifactId = "95fb1a00-5e57-4b4f-9474-3d9f2752e1b4";
    const plan = readDocumentRetrievalPlan(JSON.stringify({
      mode: "document_qa",
      inspectionMode: "exact_search",
      task: "count",
      target: { kind: "whole_document" },
      artifactIds: [artifactId],
      targetPages: [],
      exactQuery: "Fagin",
      matchMode: "whole_word",
      confidence: 0.98,
      needsClarification: false,
      reason: "The user asks for an exact occurrence count across the focused PDF.",
    }), [
      {
        artifactId,
        isThreadFocus: true,
      },
    ]);

    expect(plan).toMatchObject({
      source: "llm",
      mode: "document_qa",
      inspectionMode: "exact_search",
      task: "count",
      target: { kind: "whole_document" },
      artifactIds: [artifactId],
      exactQuery: "Fagin",
      matchMode: "whole_word",
      confidence: 0.98,
      needsClarification: false,
    });
  });

  it("counts exact document matches without counting larger words", () => {
    expect(countExactDocumentMatches(
      "Fagin saw fagin again. Fagins is not the same token. FAGIN!",
      "Fagin",
      "whole_word",
    )).toBe(3);
    expect(countExactDocumentMatches(
      "The Artful Dodger met the artful   dodger again.",
      "artful dodger",
      "phrase",
    )).toBe(2);
    expect(countExactDocumentMatches(
      "banana bandana",
      "ana",
      "substring",
    )).toBe(2);
  });

  it("normalizes on-demand document structure extraction output", () => {
    expect(readOnDemandDocumentStructureItems(JSON.stringify({
      items: [
        {
          itemType: "chapter",
          label: "CHAPTER II. Treats of Oliver Twist's Growth",
          ordinal: 2,
          pageStart: 11,
          confidence: 0.91,
          notes: "explicit heading",
        },
        {
          itemType: "not-real",
          label: "ignored",
        },
      ],
    }))).toEqual([
      {
        itemType: "chapter",
        label: "CHAPTER II. Treats of Oliver Twist's Growth",
        normalizedLabel: "chapter ii treats of oliver twist s growth",
        ordinal: 2,
        pageStart: 11,
        pageEnd: null,
        charStart: null,
        charEnd: null,
        confidenceScore: 0.91,
        extractionMethod: "llm_on_demand_document_structure",
        metadata: {
          notes: "explicit heading",
        },
      },
    ]);
  });

  it("resolves fractional document navigation targets into exact page spans", () => {
    const scope = resolveDocumentNavigationPageScope({
      retrievalPlan: readDocumentRetrievalPlan(JSON.stringify({
        mode: "document_qa",
        inspectionMode: "global_scan",
        task: "summarize",
        target: {
          kind: "fraction",
          start: 0,
          end: 1 / 3,
        },
        artifactIds: ["95fb1a00-5e57-4b4f-9474-3d9f2752e1b4"],
        targetPages: [],
        confidence: 0.94,
        needsClarification: false,
      }), [
        {
          artifactId: "95fb1a00-5e57-4b4f-9474-3d9f2752e1b4",
          isThreadFocus: true,
        },
      ]),
      inventory: [
        {
          artifactId: "95fb1a00-5e57-4b4f-9474-3d9f2752e1b4",
          pageCount: 374,
        },
      ],
      artifactIds: ["95fb1a00-5e57-4b4f-9474-3d9f2752e1b4"],
    });

    expect(scope.mode).toBe("query_scan");
    expect(scope.pagesByArtifactId.get("95fb1a00-5e57-4b4f-9474-3d9f2752e1b4")?.at(0)).toBe(1);
    expect(scope.pagesByArtifactId.get("95fb1a00-5e57-4b4f-9474-3d9f2752e1b4")?.at(-1)).toBe(125);
  });

  it("resolves exact page targets into direct page inspection", () => {
    const artifactId = "95fb1a00-5e57-4b4f-9474-3d9f2752e1b4";
    const scope = resolveDocumentNavigationPageScope({
      retrievalPlan: readDocumentRetrievalPlan(JSON.stringify({
        mode: "document_qa",
        inspectionMode: "page_range",
        task: "summarize",
        target: {
          kind: "pages",
          pages: [320],
        },
        artifactIds: [artifactId],
        targetPages: [],
        confidence: 0.94,
        needsClarification: false,
      }), [
        {
          artifactId,
          isThreadFocus: true,
        },
      ]),
      inventory: [{ artifactId, pageCount: 374 }],
      artifactIds: [artifactId],
    });

    expect(scope).toMatchObject({
      mode: "page_inspection",
      reason: "direct_page_target",
    });
    expect(scope.pagesByArtifactId.get(artifactId)).toEqual([320]);
  });

  it("uses normalized document inspection for document QA before falling back to chunks", () => {
    expect(shouldInspectNormalizedDocument({
      retrievalPlan: {
        mode: "document_qa",
        inspectionMode: "semantic_passages",
      },
      hasPageTargets: false,
    })).toBe(true);
    expect(shouldInspectNormalizedDocument({
      retrievalPlan: {
        mode: "general_chat",
        inspectionMode: "semantic_passages",
      },
      hasPageTargets: false,
    })).toBe(false);
    expect(shouldInspectNormalizedDocument({
      retrievalPlan: {
        mode: "general_chat",
        inspectionMode: "semantic_passages",
      },
      hasPageTargets: true,
    })).toBe(true);
  });

  it("marks malformed document retrieval plans as ambiguous without inventing ids", () => {
    expect(readDocumentRetrievalPlan("not json", [
      {
        artifactId: "95fb1a00-5e57-4b4f-9474-3d9f2752e1b4",
        isThreadFocus: false,
      },
    ])).toMatchObject({
      source: "llm",
      mode: "ambiguous",
      inspectionMode: "semantic_passages",
      artifactIds: [],
      targetPages: [],
      confidence: 0,
    });
  });

  it("reads query scan evidence from bounded document batches", () => {
    expect(readDocumentQueryScanResult(JSON.stringify({
      relevant: true,
      evidence: [
        "The document lists Chapter 1 through Chapter 29 in this slice.",
        "",
      ],
      partialAnswer: "This slice contains chapter headings.",
      confidence: 1.4,
    }), 51, 56)).toEqual({
      relevant: true,
      pageStart: 51,
      pageEnd: 56,
      evidence: ["The document lists Chapter 1 through Chapter 29 in this slice."],
      partialAnswer: "This slice contains chapter headings.",
      confidence: 1,
    });
  });

  it("uses the semantic selector even when no custom fetch is injected", async () => {
    const runtimeConfig = providerRuntimeConfig();
    const calls: Array<{ input: string; init?: RequestInit }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input: String(input), init });
      return new Response(JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                ids: ["canonical-current-truth:workplace"],
              }),
            },
          },
        ],
        model: runtimeConfig.model,
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    try {
      const results = await rankChatMemoryResults({
        candidates: [
          memoryCandidate("canonical-current-truth:workplace", "Current profile fact: Fortune's workplace is Polytope Labs."),
          memoryCandidate("canonical-current-truth:age", "Current profile fact: Fortune's age is 40."),
        ],
        query: "Where do I work?",
        limit: 5,
        runtimeConfig,
      });

      expect(calls.length).toBeGreaterThan(0);
      expect(results.map((result) => result.memory.id)).toEqual([
        "canonical-current-truth:workplace",
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("selects the qualified hot memory that answers the user question", async () => {
    const runtimeConfig = providerRuntimeConfig();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify({
              ids: ["canonical-current-truth:dog-name"],
            }),
          },
        },
      ],
      model: runtimeConfig.model,
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;

    try {
      const results = await rankChatMemoryResults({
        candidates: [
          memoryCandidate("canonical-current-truth:dog-name", "Current profile fact: Fortune's dog name is Ronan.\nSlot: name\nQualifier: dog\nValue: Ronan"),
          memoryCandidate("canonical-current-truth:chicken-name", "Current profile fact: Fortune's chicken name is Ada.\nSlot: name\nQualifier: chicken\nValue: Ada"),
        ],
        query: "What is my dog's name?",
        limit: 5,
        runtimeConfig,
      });

      expect(results.map((result) => result.memory.id)).toEqual([
        "canonical-current-truth:dog-name",
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

});

describe("chat memory intake", () => {
  it("runs the LLM classifier with global fetch when no injected fetch is provided", async () => {
    const originalFetch = globalThis.fetch;
    const inserts: unknown[] = [];
    const calls: string[] = [];
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [],
          }),
        }),
      }),
      insert: () => ({
        values: async (value: unknown) => {
          inserts.push(value);
          return [];
        },
      }),
    };

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return new Response(JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                facts: [
                  {
                    kind: "preference",
                    slot: "favorite_ide",
                    qualifier: null,
                    value: "Cursor",
                    valueType: "string",
                    mutable: true,
                    confidence: 0.95,
                  },
                ],
                acknowledgement: "Got it. Your favorite IDE is Cursor.",
              }),
            },
          },
        ],
        model: "test-model",
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    try {
      const result = await runChatMemoryIntake({
        db: db as never,
        twinId: "twin-1",
        userMessageId: "message-1",
        turnId: "turn-1",
        subject: "Fortune",
        message: "My favorite IDE is Cursor.",
        runtimeConfig: providerRuntimeConfig(),
      });

      expect(calls.length).toBeGreaterThan(0);
      expect(result.status).toBe("stored");
      expect(result.facts).toHaveLength(1);
      expect(inserts).toHaveLength(1);
      expect(inserts[0]).toMatchObject({
        twinId: "twin-1",
        memoryType: "preference",
        canonicalKey: "profile_slot:fortune:favorite_ide",
        subject: "Fortune",
        status: "approved",
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("stores engineering memories from chat intake as hot canonical memory", async () => {
    const originalFetch = globalThis.fetch;
    const inserts: unknown[] = [];
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [],
          }),
        }),
      }),
      insert: () => ({
        values: async (value: unknown) => {
          inserts.push(value);
          return [];
        },
      }),
    };

    globalThis.fetch = (async () => new Response(JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify({
              facts: [],
              engineeringMemories: [
                {
                  type: "user_skill",
                  scope: "global_user",
                  subject: "React and TypeScript",
                  statement: "The user is comfortable with React and TypeScript.",
                  agentContextLine: "Account for the user's React and TypeScript skill when assigning frontend work.",
                  codeReference: null,
                  confidence: 0.93,
                },
              ],
              acknowledgement: "Got it. I’ll remember that.",
            }),
          },
        },
      ],
      model: "test-model",
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;

    try {
      const result = await runChatMemoryIntake({
        db: db as never,
        twinId: "twin-1",
        userMessageId: "message-1",
        turnId: "turn-1",
        subject: "Fortune",
        message: "I am comfortable with React and TypeScript.",
        runtimeConfig: providerRuntimeConfig(),
      });

      expect(result.status).toBe("stored");
      expect(result.facts).toHaveLength(0);
      expect(result.engineeringMemories).toHaveLength(1);
      expect(inserts).toHaveLength(1);
      expect(inserts[0]).toMatchObject({
        twinId: "twin-1",
        memoryType: "fact",
        subject: "React and TypeScript",
        status: "approved",
      });
      expect(String((inserts[0] as { canonicalKey?: unknown }).canonicalKey)).toMatch(
        /^engineering_memory:global_user:user_skill:react_and_typescript:/u,
      );
      expect((inserts[0] as { metadata?: Record<string, unknown> }).metadata).toMatchObject({
        engineering: true,
        engineeringMemoryType: "user_skill",
        engineeringInstructionScope: "global_user",
        currentTruth: {
          kind: "engineering_memory",
          slot: "user_skill",
          qualifier: "global_user",
          value: "The user is comfortable with React and TypeScript.",
          agentContextLine: "Account for the user's React and TypeScript skill when assigning frontend work.",
        },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("stores a lossless hot note when the classifier fails on a teaching turn", async () => {
    const originalFetch = globalThis.fetch;
    const inserts: unknown[] = [];
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [],
          }),
        }),
      }),
      insert: () => ({
        values: async (value: unknown) => {
          inserts.push(value);
          return [];
        },
      }),
    };

    globalThis.fetch = (async () => {
      throw new DOMException("aborted", "AbortError");
    }) as typeof fetch;

    try {
      const result = await runChatMemoryIntake({
        db: db as never,
        twinId: "twin-1",
        userMessageId: "message-1",
        turnId: "turn-1",
        subject: "Fortune",
        message: "My favorite IDE is Cursor.",
        losslessFallback: true,
        runtimeConfig: providerRuntimeConfig(),
      });

      expect(result.status).toBe("stored_fallback");
      expect(result.source).toBe("lossless_fallback");
      expect(result.facts).toEqual([
        expect.objectContaining({
          kind: "note",
          slot: "user_statement",
          value: "My favorite IDE is Cursor.",
        }),
      ]);
      expect(inserts).toHaveLength(1);
      expect(inserts[0]).toMatchObject({
        twinId: "twin-1",
        memoryType: "other",
        subject: "Fortune",
        status: "approved",
      });
      expect(String((inserts[0] as { canonicalKey?: unknown }).canonicalKey)).toMatch(
        /^profile_slot:fortune:user_statement:/u,
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("parses LLM memory intake JSON into arbitrary hot profile slots", () => {
    expect(parseProfileMemoryFacts(JSON.stringify({
      facts: [
        {
          kind: "profile_fact",
          slot: "name",
          qualifier: "dog",
          value: "Ronan",
          valueType: "string",
          mutable: true,
          confidence: 0.93,
        },
        {
        kind: "profile_fact",
        slot: "maybe",
        value: "unknown",
        qualifier: null,
        confidence: 0.2,
      },
      ],
    }))).toEqual([
      {
        kind: "profile_fact",
        slot: "name",
        qualifier: "dog",
        value: "Ronan",
        valueType: "string",
        mutable: true,
        confidence: 0.93,
      },
    ]);
  });

  it("accepts LLM-generated note facts for explicit remember mode", () => {
    expect(parseProfileMemoryFacts(JSON.stringify({
      facts: [
        {
          kind: "note",
          slot: "story_idea",
          qualifier: null,
          value: "Fortune wants to remember a story idea about sovereign memory.",
          valueType: "string",
          mutable: true,
          confidence: 0.86,
        },
      ],
    }))).toEqual([
      {
        kind: "note",
        slot: "story_idea",
        qualifier: null,
        value: "Fortune wants to remember a story idea about sovereign memory",
        valueType: "string",
        mutable: true,
        confidence: 0.86,
      },
    ]);
  });

  it("accepts named-note facts whose value directly answers the note", () => {
    expect(parseProfileMemoryFacts(JSON.stringify({
      facts: [
        {
          kind: "note",
          slot: "launch_rule",
          qualifier: "odd",
          value: "velvet buttons must stay blue",
          valueType: "string",
          mutable: true,
          confidence: 0.91,
        },
      ],
    }))).toEqual([
      {
        kind: "note",
        slot: "launch_rule",
        qualifier: "odd",
        value: "velvet buttons must stay blue",
        valueType: "string",
        mutable: true,
        confidence: 0.91,
      },
    ]);
  });

  it("parses LLM engineering memory intake JSON", () => {
    expect(parseEngineeringMemoryFacts(JSON.stringify({
      engineeringMemories: [
        {
          type: "user_skill",
          scope: "global_user",
          subject: "React",
          statement: "The user is comfortable with React.",
          agentContextLine: "Account for the user's React skill when explaining frontend code.",
          codeReference: null,
          confidence: 0.91,
        },
        {
          type: "agent_instruction",
          scope: "agent_specific",
          subject: "secrets",
          statement: "Use the API key sk-1234567890abcdef.",
          confidence: 0.99,
        },
      ],
    }))).toEqual([
      {
        kind: "engineering_memory",
        engineeringMemoryType: "user_skill",
        scope: "global_user",
        subject: "React",
        statement: "The user is comfortable with React.",
        agentContextLine: "Account for the user's React skill when explaining frontend code.",
        codeReference: null,
        confidence: 0.91,
      },
    ]);
  });

  it("fast-acknowledges memory-only disclosures but not mixed questions", () => {
    const memoryIntake = {
      source: "llm" as const,
      status: "stored" as const,
      acknowledgement: "I’ll remember that.",
      engineeringMemories: [],
      facts: [{
        kind: "profile_fact" as const,
        slot: "name",
        qualifier: "dog",
        value: "Ronan",
        valueType: "string" as const,
        mutable: true,
        confidence: 0.92,
      }],
    };

    expect(shouldFastAcknowledgeMemoryIntake(turnPlan({
      turnKind: "statement",
      answerTarget: "none",
      memoryWrite: "extract",
      retrieval: "none",
    }), memoryIntake)).toBe(true);
    expect(shouldFastAcknowledgeMemoryIntake(
      turnPlan({
        turnKind: "mixed",
        answerTarget: "memory",
        memoryWrite: "extract",
        retrieval: "hot_memory",
      }),
      memoryIntake,
    )).toBe(false);
    expect(shouldFastAcknowledgeMemoryIntake(
      turnPlan({
        turnKind: "statement",
        answerTarget: "none",
        memoryWrite: "force_note",
        retrieval: "none",
      }),
      memoryIntake,
      "remember",
    )).toBe(true);
  });

  it("fast-acknowledges engineering-memory-only disclosures", () => {
    const memoryIntake = {
      source: "llm" as const,
      status: "stored" as const,
      acknowledgement: "Got it.",
      facts: [],
      engineeringMemories: [{
        kind: "engineering_memory" as const,
        engineeringMemoryType: "user_skill" as const,
        scope: "global_user" as const,
        subject: "Rust",
        statement: "The user is learning Rust.",
        agentContextLine: "Account for the user's Rust learning curve.",
        codeReference: null,
        confidence: 0.9,
      }],
    };

    expect(shouldFastAcknowledgeMemoryIntake(turnPlan({
      turnKind: "statement",
      answerTarget: "none",
      memoryWrite: "extract",
      retrieval: "none",
    }), memoryIntake)).toBe(true);
  });

  it("fast-acknowledges private disclosures without memory retrieval", () => {
    expect(shouldFastAcknowledgePrivateDisclosure(
      turnPlan({
        turnKind: "statement",
        answerTarget: "none",
        retrieval: "none",
      }),
      "private",
    )).toBe(true);
    expect(shouldFastAcknowledgePrivateDisclosure(
      turnPlan({
        turnKind: "question",
        answerTarget: "general",
        retrieval: "none",
      }),
      "private",
    )).toBe(false);
    expect(shouldFastAcknowledgePrivateDisclosure(
      turnPlan({
        turnKind: "statement",
        answerTarget: "none",
        retrieval: "none",
      }),
      "auto",
    )).toBe(false);
    const prompt = buildSivrajVoiceReplyPrompt({
      kind: "private_ack",
      userMessage: "My private test phrase is Moon River.",
      assistantName: "Jarvis",
    });
    expect(prompt[0]?.content).toContain("Private mode");
    expect(prompt[0]?.content).toContain("Do not quote or repeat the user's exact wording");
    expect(prompt[1]?.content).toContain("Moon River");
  });

  it("sanitizes generated voice replies", () => {
    expect(sanitizeSivrajVoiceReply("\"Nope, nothing saved there yet.\"")).toBe(
      "Nope, nothing saved there yet.",
    );
    expect(sanitizeSivrajVoiceReply("   ")).toBeNull();
  });

  it("interrupts failed memory intake for teaching turns instead of falling through to generic chat", () => {
    const failedIntake = {
      source: "llm" as const,
      status: "failed" as const,
      acknowledgement: null,
      facts: [],
      engineeringMemories: [],
      errorMessage: "This operation was aborted",
    };

    expect(shouldInterruptForMemoryIntakeFailure(
      turnPlan({
        answerTarget: "none",
        memoryWrite: "extract",
        retrieval: "none",
      }),
      "auto",
      failedIntake,
    )).toBe(true);
    expect(shouldInterruptForMemoryIntakeFailure(
      turnPlan({
        answerTarget: "memory",
        memoryWrite: "skip",
        retrieval: "hot_memory",
      }),
      "auto",
      failedIntake,
    )).toBe(false);
    expect(shouldInterruptForMemoryIntakeFailure(
      turnPlan({
        answerTarget: "none",
        memoryWrite: "force_note",
        retrieval: "none",
      }),
      "remember",
      failedIntake,
    )).toBe(true);
    expect(shouldInterruptForMemoryIntakeFailure(
      turnPlan({
        answerTarget: "none",
        memoryWrite: "extract",
        retrieval: "none",
      }),
      "private",
      failedIntake,
    )).toBe(false);
  });
});

describe("semantic chat title generation", () => {
  it("accepts concise semantic titles", () => {
    expect(normalizeGeneratedChatTitle("Private Calibration Code")).toBe(
      "Private Calibration Code",
    );
    expect(normalizeGeneratedChatTitle("\"Memory Search Debugging.\"")).toBe(
      "Memory Search Debugging",
    );
  });

  it("rejects unsafe, generic, and overlong generated titles", () => {
    expect(normalizeGeneratedChatTitle("New chat")).toBeNull();
    expect(normalizeGeneratedChatTitle("Here is a title: Private Calibration Code")).toBeNull();
    expect(normalizeGeneratedChatTitle("This title is far too verbose for a compact chat sidebar title")).toBeNull();
    expect(normalizeGeneratedChatTitle("ORCHID-LANTERN-742", {
      assistantMessage: "ORCHID-LANTERN-742",
    })).toBeNull();
    expect(normalizeGeneratedChatTitle("ORCHID-LANTERN-742 Lookup")).toBeNull();
  });

  it("persists generated titles for auto-owned threads", () => {
    const update = resolveThreadTitleUpdate({
      currentTitle: "What is my private calibration code?",
      currentMetadata: { surface: "web_chat" },
      fallbackTitle: "What is my private calibration code?",
      runtimeConfig: providerRuntimeConfig(),
      generatedTitle: {
        status: "generated",
        title: "Private Calibration Code",
        generatedAt: "2026-06-14T00:00:00.000Z",
        providerKind: "openrouter",
        model: "test-model",
      },
    });

    expect(update.title).toBe("Private Calibration Code");
    expect(update.metadata).toMatchObject({
      surface: "web_chat",
      titleSource: "generated",
      titleGeneratedAt: "2026-06-14T00:00:00.000Z",
      titleModel: "test-model",
      titleProviderKind: "openrouter",
    });
    expect(update.auditMetadata).toMatchObject({
      source: "generated",
      title: "Private Calibration Code",
    });
  });

  it("falls back to the cleaned first message when title generation fails", () => {
    const update = resolveThreadTitleUpdate({
      currentTitle: "New chat",
      currentMetadata: { surface: "web_chat" },
      fallbackTitle: "What is my private calibration code?",
      runtimeConfig: providerRuntimeConfig(),
      generatedTitle: {
        status: "failed",
        errorMessage: "chat_title_invalid_output",
      },
    });

    expect(update.title).toBe("What is my private calibration code?");
    expect(update.metadata).toMatchObject({
      titleSource: "fallback",
      titleErrorMessage: "chat_title_invalid_output",
    });
  });

  it("does not overwrite non-auto-owned titles", () => {
    const update = resolveThreadTitleUpdate({
      currentTitle: "Launch Strategy",
      currentMetadata: { surface: "web_chat" },
      fallbackTitle: "What should we launch next?",
      runtimeConfig: providerRuntimeConfig(),
      generatedTitle: {
        status: "generated",
        title: "Next Launch Ideas",
        generatedAt: "2026-06-14T00:00:00.000Z",
        providerKind: "openrouter",
        model: "test-model",
      },
    });

    expect(update.title).toBe("Launch Strategy");
    expect(update.metadata).toEqual({ surface: "web_chat" });
    expect(update.auditMetadata).toMatchObject({
      source: "skipped",
      reason: "title_not_auto_owned",
    });
  });
});

function chatMessageRow(input: {
  id: string;
  role: "user" | "assistant";
  content: string;
  status?: "pending" | "streaming" | "completed" | "failed" | "cancelled";
}) {
  return {
    id: input.id,
    twinId: "twin-1",
    threadId: "thread-1",
    turnId: null,
    role: input.role,
    status: input.status ?? "completed",
    content: input.content,
    providerKind: null,
    model: null,
    memoryFragmentIds: [],
    citations: null,
    usage: null,
    metadata: null,
    createdAt: new Date("2026-06-13T00:00:00Z"),
  } as const;
}

function providerRuntimeConfig() {
  return {
    id: "provider-1",
    providerKind: "openrouter",
    displayName: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "test-model",
    apiKey: "test-key",
    source: "user",
  } as const;
}

function memoryCandidate(id: string, content: string) {
  return {
    id,
    twinId: "twin-1",
    sourceArtifactId: "source-1",
    content,
    summary: content,
    importanceScore: 1,
    confidenceScore: 1,
    occurredAt: null,
    createdAt: new Date("2026-06-13T00:00:00Z"),
  };
}
