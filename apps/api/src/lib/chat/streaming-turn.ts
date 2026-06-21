/**
 * SSE streaming turn orchestration.
 *
 * Owns the full lifecycle for `POST /threads/:id/turn`: queued turn seed, context
 * resolution, memory intake, retrieval, token streaming, completion, learning enqueue,
 * and cancel/failure events.
 */
import { createOpenAICompatibleChatGenerator } from "@sivraj/llm";
import type { Context } from "hono";
import type { AuthEnv } from "../../middleware/auth.js";
import type {
  ChatMemoryContext,
  ChatMemoryIntent,
  ChatRetrievalStatus,
  ChatRouteDependencies,
  ChatRuntimeConfig,
  ChatSurface,
  ChatThreadGate,
  ChatTurnEventStream,
} from "../../types/chat.types.js";
import { emptyMemoryIntakeForIntent } from "../../types/chat.types.js";
import { readRecord } from "../http/route-helpers.js";
import {
  errorMessage,
  loadThreadMessages,
  readPositiveInteger,
  toMessageResponse,
} from "./helpers.js";
import { runChatMemoryIntake } from "./memory-intake.js";
import {
  fallbackConversationContextResolution,
  resolveConversationContext,
} from "./conversation-context.js";
import { buildPromptMessages } from "./prompt-builder.js";
import {
  emptyDocumentContext,
  loadDocumentContextForIntent,
  shouldLoadDocumentContext,
  updateThreadDocumentFocusFromContext,
} from "./document-retrieval.js";
import {
  loadTurnPlanningMemoryHints,
  resolveUserMemorySubject,
} from "./current-truth.js";
import {
  emptyMemoryContext,
  loadMemoryContext,
} from "./memory-retrieval.js";
import { estimateMemoryTokenSavings } from "./token-accounting.js";
import { sanitizeAssistantContent } from "./chat-sanitize.js";
import {
  buildMemoryIntakeAcknowledgement,
  buildEmptyRetrievalFallbackReply,
  buildRetrievalFallbackReply,
  memoryIntakeFailureMessage,
  memoryIntakeIntentFromTurnPlan,
  memoryIntakeMessageFromTurnPlan,
  resolveCoreCommsAnswer,
  shouldFastAcknowledgeMemoryIntake,
  shouldFastAcknowledgePrivateDisclosure,
  shouldFastReplyMissingMemory,
  shouldFallbackForRetrievalDegradation,
  shouldInterruptForMemoryIntakeFailure,
  shouldLoadMemoryContext,
  shouldProceedWithPartialRetrieval,
  shouldRunChatMemoryIntake,
  shouldUseLosslessMemoryFallback,
} from "./turn-policy.js";
import { generateSivrajVoiceReply } from "./voice-reply.js";
import {
  loadCachedCoreCommsContext,
  loadCachedRuntimeProviderConfig,
} from "./chat-cache.js";
import { buildCitations } from "./turn-generation.js";
import { enqueueCompletedChatTurnLearning } from "./chat-learning-queue.js";
import { publicChatFailureMessage, readChatErrorCode } from "./chat-errors.js";
import {
  completeStreamingTurn,
  createQueuedTurn,
  markTurnCancelled,
  markTurnFailed,
  markTurnGenerating,
  markTurnRetrievingContext,
  recordChatMemoryIntakeOutcome,
  recordCompletedStreamingTurnAudit,
  updateAssistantPartial,
} from "./turn-persistence.js";
import {
  readPublicChatTimings,
  timedPromise,
  toTurnResponse,
  writeChatTurnEvent,
} from "./turn-events.js";
import type {
  ChatRetrievalDegradationReason,
  ChatRetrievalTarget,
  ConversationContextResolution,
  DocumentContext,
} from "./turn-types.js";

export type RunStreamingChatTurnInput = {
  c: Context<AuthEnv>;
  deps: ChatRouteDependencies;
  gate: ChatThreadGate;
  stream: ChatTurnEventStream;
  content: string;
  memoryIntent: ChatMemoryIntent;
  surface: ChatSurface;
  retryAttempt: number;
  abortController: AbortController;
};

const CHAT_RETRY_TIMEOUT_BASE_MS = 30_000;
const CHAT_RETRY_TIMEOUT_STEP_MS = 15_000;
const CHAT_RETRY_TIMEOUT_MAX_MS = 90_000;

/** Run one streaming chat turn inside an open SSE stream. */
export async function runStreamingChatTurn(input: RunStreamingChatTurnInput): Promise<void> {
  const { c, deps, gate, stream, content, memoryIntent, surface, retryAttempt, abortController } = input;
  const retryTimeoutMs = chatTimeoutMsForRetryAttempt(retryAttempt);
  const turnStartedAt = Date.now();
  const timings: Record<string, number> = {};
  const createTurnStartedAt = Date.now();
const turnSeed = await createQueuedTurn({
    db: deps.db,
    twinId: gate.twinId,
    threadId: gate.thread.id,
    content,
    memoryIntent,
    surface,
});
timings.turnCreateMs = Date.now() - createTurnStartedAt;
await writeChatTurnEvent(stream, "turn.created", {
    turn: toTurnResponse(turnSeed.turn),
    userMessage: toMessageResponse(turnSeed.userMessage),
    assistantMessage: toMessageResponse(turnSeed.assistantMessage),
});
try {
    const contextStartedAt = Date.now();
    const runtimeConfigPromise = timedPromise(timings, "providerConfigMs", loadCachedRuntimeProviderConfig(deps.db, gate.twinId));
    const retrievingContextPromise = timedPromise(timings, "turnStatusRetrievingMs", markTurnRetrievingContext(deps.db, turnSeed.turn.id));
    const coreCommsContextPromise = timedPromise(timings, "coreCommsContextMs", loadCachedCoreCommsContext(deps.db, gate.twinId));
    const recentMessagesPromise = timedPromise(timings, "recentMessagesMs", loadThreadMessages(deps.db, gate.twinId, gate.thread.id, readPositiveInteger(process.env["CHAT_RECENT_RAW_MESSAGE_LIMIT"], 48)));
    const planningMemoryHintsPromise = timedPromise(timings, "planningMemoryHintsMs", loadTurnPlanningMemoryHints(deps.db, gate.twinId));
    const [runtimeConfig, coreCommsContext, recentMessages, planningMemoryHints,] = await Promise.all([
        runtimeConfigPromise,
        coreCommsContextPromise,
        recentMessagesPromise,
        planningMemoryHintsPromise,
        retrievingContextPromise,
    ]);
    const contextResolution = runtimeConfig
        ? await timedPromise(timings, "contextResolveMs", resolveConversationContext({
            currentMessage: content,
            recentMessages,
            excludeMessageIds: new Set([turnSeed.userMessage.id, turnSeed.assistantMessage.id]),
            memoryIntent,
            coreCommsContext,
            memoryHints: planningMemoryHints,
            runtimeConfig,
            llmFetch: deps.llmFetch,
            contextResolveTimeoutMs: retryTimeoutMs,
        }))
        : fallbackConversationContextResolution(content);
    const memoryIntake = runtimeConfig && shouldRunChatMemoryIntake(contextResolution, memoryIntent)
        ? await timedPromise(timings, "memoryIntakeMs", runChatMemoryIntake({
            db: deps.db,
            twinId: gate.twinId,
            userMessageId: turnSeed.userMessage.id,
            turnId: turnSeed.turn.id,
            subject: resolveUserMemorySubject(coreCommsContext),
            message: memoryIntakeMessageFromTurnPlan(content, contextResolution),
            intent: memoryIntakeIntentFromTurnPlan(contextResolution),
            losslessFallback: shouldUseLosslessMemoryFallback(contextResolution, memoryIntent),
            runtimeConfig,
            llmFetch: deps.llmFetch,
        }))
        : emptyMemoryIntakeForIntent(memoryIntent);
    await recordChatMemoryIntakeOutcome({
        db: deps.db,
        turnId: turnSeed.turn.id,
        userMessageId: turnSeed.userMessage.id,
        memoryIntent,
        memoryIntake,
    });
    if (shouldInterruptForMemoryIntakeFailure(contextResolution, memoryIntent, memoryIntake)) {
        throw new Error(memoryIntakeFailureMessage(memoryIntake));
    }
    if (runtimeConfig && shouldFastAcknowledgePrivateDisclosure(contextResolution, memoryIntent)) {
        const memoryContext = emptyMemoryContext();
        const documentContext = emptyDocumentContext();
        const retrievalStatus = notRequestedRetrievalStatus();
        const citations = buildCitations(memoryContext, documentContext);
        const tokenSavings = estimateMemoryTokenSavings(memoryContext);
        const finalContent = await timedPromise(timings, "voiceReplyMs", generateSivrajVoiceReply({
            kind: "private_ack",
            userMessage: content,
            runtimeConfig,
            llmFetch: deps.llmFetch,
            assistantName: coreCommsContext.assistantName,
        }));
        timings.contextReadyMs = Date.now() - contextStartedAt;
        await writeChatTurnEvent(stream, "context.ready", {
            turnId: turnSeed.turn.id,
            memoryCount: 0,
            citations,
            documentPassageCount: 0,
            contextResolution,
            retrievalStatus,
            tokenContextSaved: 0,
            tokenSavings,
            timings: readPublicChatTimings(timings),
        });
        await writeChatTurnEvent(stream, "assistant.delta", {
            turnId: turnSeed.turn.id,
            assistantMessageId: turnSeed.assistantMessage.id,
            delta: finalContent,
        });
        const completedAssistant = await timedPromise(timings, "completionPersistMs", completeStreamingTurn({
            db: deps.db,
            turnId: turnSeed.turn.id,
            assistantMessageId: turnSeed.assistantMessage.id,
            finalContent,
            runtimeConfig,
            model: runtimeConfig.model,
            memoryContext,
            documentContext,
            contextResolution,
            citations,
            usage: {},
            tokenSavings,
            timings: readPublicChatTimings(timings),
            retrievalStatus,
            surface,
        }));
        timings.totalCompletedMs = Date.now() - turnStartedAt;
        await writeChatTurnEvent(stream, "assistant.completed", {
            turnId: turnSeed.turn.id,
            assistantMessage: toMessageResponse(completedAssistant),
            context: {
                citations,
                memoryCount: 0,
                documentPassageCount: 0,
                documentRetrievalPlan: documentContext.retrievalPlan,
                contextResolution,
                retrievalStatus,
                tokenContextSaved: 0,
                tokenSavings,
                timings: readPublicChatTimings(timings),
                policy: {
                    rawArtifactsIncluded: false,
                    memory: "Private mode skipped memory storage and foreground archive retrieval.",
                },
            },
        });
        void recordCompletedStreamingTurnAudit({
            c,
            db: deps.db,
            gate,
            llmFetch: deps.llmFetch,
            content,
            finalContent,
            runtimeConfig,
            model: runtimeConfig.model,
            memoryContext,
            documentContext,
            contextResolution,
            citations,
            usage: {},
            tokenSavings,
            timings: readPublicChatTimings(timings),
            retrievalStatus,
        });
        return;
    }
    if (runtimeConfig && shouldFastAcknowledgeMemoryIntake(contextResolution, memoryIntake, memoryIntent)) {
        const memoryContext = emptyMemoryContext();
        const documentContext = emptyDocumentContext();
        const retrievalStatus = notRequestedRetrievalStatus();
        const citations = buildCitations(memoryContext, documentContext);
        const tokenSavings = estimateMemoryTokenSavings(memoryContext);
        const finalContent = buildMemoryIntakeAcknowledgement(memoryIntake);
        timings.contextReadyMs = Date.now() - contextStartedAt;
        await writeChatTurnEvent(stream, "context.ready", {
            turnId: turnSeed.turn.id,
            memoryCount: 0,
            citations,
            documentPassageCount: 0,
            contextResolution,
            retrievalStatus,
            tokenContextSaved: 0,
            tokenSavings,
            timings: readPublicChatTimings(timings),
        });
        await writeChatTurnEvent(stream, "assistant.delta", {
            turnId: turnSeed.turn.id,
            assistantMessageId: turnSeed.assistantMessage.id,
            delta: finalContent,
        });
        const completedAssistant = await timedPromise(timings, "completionPersistMs", completeStreamingTurn({
            db: deps.db,
            turnId: turnSeed.turn.id,
            assistantMessageId: turnSeed.assistantMessage.id,
            finalContent,
            runtimeConfig,
            model: runtimeConfig.model,
            memoryContext,
            documentContext,
            contextResolution,
            citations,
            usage: {},
            tokenSavings,
            timings: readPublicChatTimings(timings),
            retrievalStatus,
            surface,
        }));
        timings.totalCompletedMs = Date.now() - turnStartedAt;
        await writeChatTurnEvent(stream, "assistant.completed", {
            turnId: turnSeed.turn.id,
            assistantMessage: toMessageResponse(completedAssistant),
            context: {
                citations,
                memoryCount: 0,
                documentPassageCount: 0,
                documentRetrievalPlan: documentContext.retrievalPlan,
                contextResolution,
                retrievalStatus,
                tokenContextSaved: 0,
                tokenSavings,
                timings: readPublicChatTimings(timings),
                policy: {
                    rawArtifactsIncluded: false,
                    memory: memoryIntent === "remember"
                        ? "Sivraj intentionally committed hot memory without foreground archive retrieval."
                        : "Sivraj committed hot memory without foreground archive retrieval.",
                },
            },
        });
        void recordCompletedStreamingTurnAudit({
            c,
            db: deps.db,
            gate,
            llmFetch: deps.llmFetch,
            content,
            finalContent,
            runtimeConfig,
            model: runtimeConfig.model,
            memoryContext,
            documentContext,
            contextResolution,
            citations,
            usage: {},
            tokenSavings,
            timings: readPublicChatTimings(timings),
            retrievalStatus,
        });
        return;
    }
    const retrievalQuery = contextResolution.standaloneQuery;
    const coreCommsAnswer = runtimeConfig
        ? resolveCoreCommsAnswer(content, coreCommsContext) ??
            resolveCoreCommsAnswer(retrievalQuery, coreCommsContext)
        : null;
    if (runtimeConfig && coreCommsAnswer) {
        const memoryContext = emptyMemoryContext();
        const documentContext = emptyDocumentContext();
        const retrievalStatus = notRequestedRetrievalStatus();
        const citations = buildCitations(memoryContext, documentContext);
        const tokenSavings = estimateMemoryTokenSavings(memoryContext);
        timings.contextReadyMs = Date.now() - contextStartedAt;
        await completeFallbackStreamingTurn({
            c,
            deps,
            gate,
            stream,
            turnId: turnSeed.turn.id,
            assistantMessageId: turnSeed.assistantMessage.id,
            content,
            finalContent: coreCommsAnswer.content,
            runtimeConfig,
            memoryContext,
            documentContext,
            contextResolution,
            citations,
            tokenSavings,
            timings,
            surface,
            retrievalStatus,
            turnStartedAt,
            policyMemory: "Sivraj answered from authoritative core comms identity context.",
        });
        return;
    }
    const shouldLoadMemory = shouldLoadMemoryContext(contextResolution, retrievalQuery);
    const shouldLoadDocument = shouldLoadDocumentContext(contextResolution);
    const loadedMemory = shouldLoadMemory && runtimeConfig
        ? await loadMemoryContextForTurn({
            deps,
            timings,
            twinId: gate.twinId,
            query: retrievalQuery,
            contextResolution,
            runtimeConfig,
        })
        : {
            memoryContext: emptyMemoryContext(),
            retrievalStatus: notRequestedRetrievalStatus(),
        };
    const memoryContext = loadedMemory.memoryContext;
    const loadedDocument = shouldLoadDocument && runtimeConfig
        ? await loadDocumentContextForTurn({
            deps,
            timings,
            gate,
            query: retrievalQuery,
            contextResolution,
            runtimeConfig,
            retryTimeoutMs,
        })
        : {
            documentContext: emptyDocumentContext(),
            retrievalStatus: notRequestedRetrievalStatus(),
        };
    const documentContext = loadedDocument.documentContext;
    const retrievalStatus = resolveTurnRetrievalStatus([
        loadedMemory.retrievalStatus,
        loadedDocument.retrievalStatus,
    ]);
    if (shouldLoadDocument) {
        await timedPromise(timings, "documentFocusMs", updateThreadDocumentFocusFromContext({
            db: deps.db,
            twinId: gate.twinId,
            thread: gate.thread,
            documentContext,
            reason: "document_retrieval",
        }));
    }
    timings.contextReadyMs = Date.now() - contextStartedAt;
    if (!runtimeConfig) {
        throw new Error("llm_provider_not_configured");
    }
    const citations = buildCitations(memoryContext, documentContext);
    const tokenSavings = estimateMemoryTokenSavings(memoryContext);
    const estimatedSavedTokens = tokenSavings.estimatedTokensSaved;
    if (
        shouldFallbackForRetrievalDegradation(contextResolution, retrievalStatus) &&
        !shouldProceedWithPartialRetrieval({ retrievalStatus, memoryContext, documentContext })
    ) {
        const finalContent = retrievalStatus.message ??
            buildRetrievalFallbackReply(retrievalStatus.target ?? "memory", retrievalStatus.reason);
        await completeFallbackStreamingTurn({
            c,
            deps,
            gate,
            stream,
            turnId: turnSeed.turn.id,
            assistantMessageId: turnSeed.assistantMessage.id,
            content,
            finalContent,
            runtimeConfig,
            memoryContext,
            documentContext,
            contextResolution,
            citations,
            tokenSavings,
            timings,
            surface,
            retrievalStatus,
            turnStartedAt,
            policyMemory:
                retrievalStatus.target === "document"
                    ? "Sivraj could not retrieve document context for this turn, so it returned a safe fallback."
                    : "Sivraj could not retrieve durable memory for this turn, so it returned a safe fallback.",
        });
        return;
    }
    if (runtimeConfig && shouldFastReplyMissingMemory({
        query: retrievalQuery,
        contextResolution,
        coreCommsContext,
        memoryContext,
        documentContext,
    })) {
        const missingMemoryStatus = retrievalStatus.state === "not_requested"
            ? emptyRetrievalStatus("memory")
            : retrievalStatus;
        const finalContent = buildEmptyRetrievalFallbackReply("memory");
        await writeChatTurnEvent(stream, "context.ready", {
            turnId: turnSeed.turn.id,
            memoryCount: 0,
            citations,
            documentPassageCount: documentContext.passages.length,
            contextResolution,
            retrievalStatus: missingMemoryStatus,
            tokenContextSaved: estimatedSavedTokens,
            tokenSavings,
            timings: readPublicChatTimings(timings),
        });
        await writeChatTurnEvent(stream, "assistant.delta", {
            turnId: turnSeed.turn.id,
            assistantMessageId: turnSeed.assistantMessage.id,
            delta: finalContent,
        });
        const completedAssistant = await timedPromise(timings, "completionPersistMs", completeStreamingTurn({
            db: deps.db,
            turnId: turnSeed.turn.id,
            assistantMessageId: turnSeed.assistantMessage.id,
            finalContent,
            runtimeConfig,
            model: runtimeConfig.model,
            memoryContext,
            documentContext,
            contextResolution,
            citations,
            usage: {},
            tokenSavings,
            timings: readPublicChatTimings(timings),
            retrievalStatus: missingMemoryStatus,
            surface,
        }));
        timings.totalCompletedMs = Date.now() - turnStartedAt;
        await writeChatTurnEvent(stream, "assistant.completed", {
            turnId: turnSeed.turn.id,
            assistantMessage: toMessageResponse(completedAssistant),
            context: {
                citations,
                memoryCount: 0,
                documentPassageCount: documentContext.passages.length,
                documentRetrievalPlan: documentContext.retrievalPlan,
                contextResolution,
                retrievalStatus: missingMemoryStatus,
                tokenContextSaved: estimatedSavedTokens,
                tokenSavings,
                timings: readPublicChatTimings(timings),
                policy: {
                    rawArtifactsIncluded: false,
                    memory: "Sivraj checked hot memory and did not find a matching current truth.",
                },
            },
        });
        void recordCompletedStreamingTurnAudit({
            c,
            db: deps.db,
            gate,
            llmFetch: deps.llmFetch,
            content,
            finalContent,
            runtimeConfig,
            model: runtimeConfig.model,
            memoryContext,
            documentContext,
            contextResolution,
            citations,
            usage: {},
            tokenSavings,
            timings: readPublicChatTimings(timings),
            retrievalStatus: missingMemoryStatus,
        });
        return;
    }
    await writeChatTurnEvent(stream, "context.ready", {
        turnId: turnSeed.turn.id,
        memoryCount: memoryContext.results.length,
        citations,
        documentPassageCount: documentContext.passages.length,
        contextResolution,
        retrievalStatus,
        tokenContextSaved: estimatedSavedTokens,
        tokenSavings,
        timings: readPublicChatTimings(timings),
    });
    const promptMessages = buildPromptMessages({
        currentMessage: content,
        contextResolution,
        coreCommsContext,
        memoryContext,
        documentContext,
        recentMessages,
        excludeMessageIds: new Set([turnSeed.userMessage.id, turnSeed.assistantMessage.id]),
        providerLabel: runtimeConfig.displayName,
    });
    const modelStreamStartedAt = Date.now();
    const chatStream = createOpenAICompatibleChatGenerator({
        provider: runtimeConfig.providerKind,
        apiKey: runtimeConfig.apiKey,
        model: runtimeConfig.model,
        baseUrl: runtimeConfig.baseUrl,
        fetch: deps.llmFetch,
        timeoutMs: readPositiveInteger(process.env["LLM_REQUEST_TIMEOUT_MS"], 30_000),
    }).streamChat({
        messages: promptMessages,
        temperature: 0.2,
        signal: abortController.signal,
    });
    timings.modelStreamCreateMs = Date.now() - modelStreamStartedAt;
    await timedPromise(timings, "turnStatusGeneratingMs", markTurnGenerating({
        db: deps.db,
        turnId: turnSeed.turn.id,
        assistantMessageId: turnSeed.assistantMessage.id,
        runtimeConfig,
    }));
    let contentBuffer = "";
    let streamedContent = "";
    let lastPersistedAt = Date.now();
    const firstTokenStartedAt = Date.now();
    for await (const delta of chatStream.textStream) {
        if (abortController.signal.aborted) {
            throw new Error("chat_turn_cancelled");
        }
        if (timings.providerFirstTokenMs === undefined) {
            timings.providerFirstTokenMs = Date.now() - firstTokenStartedAt;
            timings.totalFirstTokenMs = Date.now() - turnStartedAt;
        }
        contentBuffer += delta;
        const sanitizedContent = sanitizeAssistantContent(contentBuffer);
        const sanitizedDelta = sanitizedContent.slice(streamedContent.length);
        streamedContent = sanitizedContent;
        if (sanitizedDelta.length > 0) {
            await writeChatTurnEvent(stream, "assistant.delta", {
                turnId: turnSeed.turn.id,
                assistantMessageId: turnSeed.assistantMessage.id,
                delta: sanitizedDelta,
            });
        }
        if (Date.now() - lastPersistedAt > 500) {
            lastPersistedAt = Date.now();
            await updateAssistantPartial(deps.db, turnSeed.assistantMessage.id, streamedContent);
        }
    }
    const output = await chatStream.result;
    timings.providerTotalMs = Date.now() - firstTokenStartedAt;
    const finalContent = sanitizeAssistantContent(output.content || contentBuffer);
    const usage = readRecord(output.metadata?.usage);
    const completedAssistant = await timedPromise(timings, "completionPersistMs", completeStreamingTurn({
        db: deps.db,
        turnId: turnSeed.turn.id,
        assistantMessageId: turnSeed.assistantMessage.id,
        finalContent,
        runtimeConfig,
        model: output.model,
        memoryContext,
        documentContext,
        contextResolution,
        citations,
        usage,
        tokenSavings,
        timings: readPublicChatTimings(timings),
        retrievalStatus,
        surface,
    }));
    timings.totalCompletedMs = Date.now() - turnStartedAt;
    await writeChatTurnEvent(stream, "assistant.completed", {
        turnId: turnSeed.turn.id,
        assistantMessage: toMessageResponse(completedAssistant),
        context: {
            citations,
            memoryCount: memoryContext.results.length,
            documentPassageCount: documentContext.passages.length,
            documentRetrievalPlan: documentContext.retrievalPlan,
            contextResolution,
            retrievalStatus,
            tokenContextSaved: estimatedSavedTokens,
            tokenSavings,
            timings: readPublicChatTimings(timings),
            policy: {
                rawArtifactsIncluded: false,
                memory: "Sivraj retrieved durable memory instead of replaying full history.",
            },
        },
    });
    void recordCompletedStreamingTurnAudit({
        c,
        db: deps.db,
        gate,
        llmFetch: deps.llmFetch,
        content,
        finalContent,
        runtimeConfig,
        model: output.model,
        memoryContext,
        documentContext,
        contextResolution,
        citations,
        usage,
        tokenSavings,
        timings: readPublicChatTimings(timings),
        retrievalStatus,
    });
    if (memoryIntent !== "private") {
        void enqueueCompletedChatTurnLearning({
            db: deps.db,
            privateMemoryStorage: deps.privateMemoryStorage,
            artifactProcessingQueue: deps.artifactProcessingQueue,
            gate,
            userMessage: content,
            assistantMessage: finalContent,
            userMessageId: turnSeed.userMessage.id,
            assistantMessageId: turnSeed.assistantMessage.id,
            turnId: turnSeed.turn.id,
            model: output.model,
            providerKind: runtimeConfig.providerKind,
            memoryIntent,
        });
    }
}
catch (error) {
    if (abortController.signal.aborted || errorMessage(error) === "chat_turn_cancelled") {
        await markTurnCancelled(deps.db, turnSeed.turn.id, turnSeed.assistantMessage.id);
        await writeChatTurnEvent(stream, "turn.cancelled", {
            turnId: turnSeed.turn.id,
        });
        return;
    }
    const rawMessage = errorMessage(error);
    const message = publicChatFailureMessage(rawMessage);
    await writeChatTurnEvent(stream, "turn.failed", {
        turnId: turnSeed.turn.id,
        assistantMessageId: turnSeed.assistantMessage.id,
        error: {
            code: readChatErrorCode(rawMessage),
            message,
            retryable: isRetryableChatTurnError(rawMessage),
            retryAttempt,
            nextRetryAttempt: nextChatRetryAttempt(retryAttempt),
            timeoutMs: retryTimeoutMs,
            nextTimeoutMs: chatTimeoutMsForRetryAttempt(nextChatRetryAttempt(retryAttempt)),
        },
    });
    await markTurnFailed(deps.db, turnSeed.turn.id, turnSeed.assistantMessage.id, message, surface);
}
}

async function loadMemoryContextForTurn(input: {
    deps: ChatRouteDependencies;
    timings: Record<string, number>;
    twinId: string;
    query: string;
    contextResolution: ConversationContextResolution;
    runtimeConfig: ChatRuntimeConfig;
}): Promise<{ memoryContext: ChatMemoryContext; retrievalStatus: ChatRetrievalStatus }> {
    try {
        const memoryContext = await timedPromise(input.timings, "memoryContextMs", loadMemoryContext({
            db: input.deps.db,
            privateMemoryReader: input.deps.privateMemoryReader,
            memorySearchConfig: input.deps.memorySearchConfig,
            twinId: input.twinId,
            query: input.query,
            contextResolution: input.contextResolution,
            runtimeConfig: input.runtimeConfig,
            llmFetch: input.deps.llmFetch,
        }));
        return {
            memoryContext,
            retrievalStatus: memoryContext.results.length > 0
                ? retrievedRetrievalStatus("memory")
                : emptyRetrievalStatus("memory"),
        };
    } catch (error) {
        const reason = readRetrievalFailureReason(error);
        console.warn("chat memory retrieval degraded", {
            error: errorMessage(error),
            reason,
        });
        return {
            memoryContext: emptyMemoryContext(),
            retrievalStatus: degradedRetrievalStatus("memory", reason),
        };
    }
}

async function loadDocumentContextForTurn(input: {
    deps: ChatRouteDependencies;
    timings: Record<string, number>;
    gate: ChatThreadGate;
    query: string;
    contextResolution: ConversationContextResolution;
    runtimeConfig: ChatRuntimeConfig;
    retryTimeoutMs: number;
}): Promise<{ documentContext: DocumentContext; retrievalStatus: ChatRetrievalStatus }> {
    try {
        const documentContext = await timedPromise(input.timings, "documentContextMs", loadDocumentContextForIntent({
            db: input.deps.db,
            privateMemoryReader: input.deps.privateMemoryReader,
            twinId: input.gate.twinId,
            thread: input.gate.thread,
            query: input.query,
            contextResolution: input.contextResolution,
            runtimeConfig: input.runtimeConfig,
            llmFetch: input.deps.llmFetch,
            documentReadTimeoutMs: input.retryTimeoutMs,
        }));
        return {
            documentContext,
            retrievalStatus: documentContext.passages.length > 0 || documentContext.inspectionSources.length > 0
                ? retrievedRetrievalStatus("document")
                : emptyRetrievalStatus("document"),
        };
    } catch (error) {
        const reason = readRetrievalFailureReason(error);
        console.warn("chat document retrieval degraded", {
            error: errorMessage(error),
            reason,
        });
        return {
            documentContext: emptyDocumentContext(),
            retrievalStatus: degradedRetrievalStatus("document", reason),
        };
    }
}

async function completeFallbackStreamingTurn(input: {
    c: Context<AuthEnv>;
    deps: ChatRouteDependencies;
    gate: ChatThreadGate;
    stream: ChatTurnEventStream;
    turnId: string;
    assistantMessageId: string;
    content: string;
    finalContent: string;
    runtimeConfig: ChatRuntimeConfig;
    memoryContext: ChatMemoryContext;
    documentContext: DocumentContext;
    contextResolution: ConversationContextResolution;
    citations: ReturnType<typeof buildCitations>;
    tokenSavings: ReturnType<typeof estimateMemoryTokenSavings>;
    timings: Record<string, number>;
    surface: ChatSurface;
    retrievalStatus: ChatRetrievalStatus;
    turnStartedAt: number;
    policyMemory: string;
}) {
    await writeChatTurnEvent(input.stream, "context.ready", {
        turnId: input.turnId,
        memoryCount: input.memoryContext.results.length,
        citations: input.citations,
        documentPassageCount: input.documentContext.passages.length,
        contextResolution: input.contextResolution,
        retrievalStatus: input.retrievalStatus,
        tokenContextSaved: input.tokenSavings.estimatedTokensSaved,
        tokenSavings: input.tokenSavings,
        timings: readPublicChatTimings(input.timings),
    });
    await writeChatTurnEvent(input.stream, "assistant.delta", {
        turnId: input.turnId,
        assistantMessageId: input.assistantMessageId,
        delta: input.finalContent,
    });
    const completedAssistant = await timedPromise(input.timings, "completionPersistMs", completeStreamingTurn({
        db: input.deps.db,
        turnId: input.turnId,
        assistantMessageId: input.assistantMessageId,
        finalContent: input.finalContent,
        runtimeConfig: input.runtimeConfig,
        model: input.runtimeConfig.model,
        memoryContext: input.memoryContext,
        documentContext: input.documentContext,
        contextResolution: input.contextResolution,
        citations: input.citations,
        usage: {},
        tokenSavings: input.tokenSavings,
        timings: readPublicChatTimings(input.timings),
        retrievalStatus: input.retrievalStatus,
        surface: input.surface,
    }));
    input.timings.totalCompletedMs = Date.now() - input.turnStartedAt;
    await writeChatTurnEvent(input.stream, "assistant.completed", {
        turnId: input.turnId,
        assistantMessage: toMessageResponse(completedAssistant),
        context: {
            citations: input.citations,
            memoryCount: input.memoryContext.results.length,
            documentPassageCount: input.documentContext.passages.length,
            documentRetrievalPlan: input.documentContext.retrievalPlan,
            contextResolution: input.contextResolution,
            retrievalStatus: input.retrievalStatus,
            tokenContextSaved: input.tokenSavings.estimatedTokensSaved,
            tokenSavings: input.tokenSavings,
            timings: readPublicChatTimings(input.timings),
            policy: {
                rawArtifactsIncluded: false,
                memory: input.policyMemory,
            },
        },
    });
    void recordCompletedStreamingTurnAudit({
        c: input.c,
        db: input.deps.db,
        gate: input.gate,
        llmFetch: input.deps.llmFetch,
        content: input.content,
        finalContent: input.finalContent,
        runtimeConfig: input.runtimeConfig,
        model: input.runtimeConfig.model,
        memoryContext: input.memoryContext,
        documentContext: input.documentContext,
        contextResolution: input.contextResolution,
        citations: input.citations,
        usage: {},
        tokenSavings: input.tokenSavings,
        timings: readPublicChatTimings(input.timings),
        retrievalStatus: input.retrievalStatus,
    });
}

function resolveTurnRetrievalStatus(statuses: ChatRetrievalStatus[]): ChatRetrievalStatus {
    const requested = statuses.filter((status) => status.state !== "not_requested");
    if (requested.length === 0) {
        return notRequestedRetrievalStatus();
    }
    return requested.find((status) => status.state === "degraded") ??
        requested.find((status) => status.state === "retrieved") ??
        requested[0] ??
        notRequestedRetrievalStatus();
}

function notRequestedRetrievalStatus(): ChatRetrievalStatus {
    return {
        state: "not_requested",
        target: null,
        reason: null,
        message: null,
    };
}

function retrievedRetrievalStatus(target: ChatRetrievalTarget): ChatRetrievalStatus {
    return {
        state: "retrieved",
        target,
        reason: null,
        message: null,
    };
}

function emptyRetrievalStatus(target: ChatRetrievalTarget): ChatRetrievalStatus {
    return {
        state: "empty",
        target,
        reason: null,
        message: buildEmptyRetrievalFallbackReply(target),
    };
}

function degradedRetrievalStatus(
    target: ChatRetrievalTarget,
    reason: ChatRetrievalDegradationReason,
): ChatRetrievalStatus {
    return {
        state: "degraded",
        target,
        reason,
        message: buildRetrievalFallbackReply(target, reason),
    };
}

function readRetrievalFailureReason(error: unknown): ChatRetrievalDegradationReason {
    const message = errorMessage(error).toLowerCase();
    if (
        message.includes("timeout") ||
        message.includes("timed out") ||
        message.includes("aborted")
    ) {
        return "timeout";
    }
    if (
        message.includes("not_configured") ||
        message.includes("unavailable") ||
        message.includes("cannot connect") ||
        message.includes("connect timeout") ||
        message.includes("fetch failed")
    ) {
        return "storage_unavailable";
    }
    if (
        message.includes("read") ||
        message.includes("decrypt") ||
        message.includes("seal") ||
        message.includes("blob") ||
        message.includes("walrus") ||
        message.includes("sha") ||
        message.includes("sliver")
    ) {
        return "read_failed";
    }
    if (message.includes("planner")) {
        return "planner_unavailable";
    }
    return "unknown";
}

function chatTimeoutMsForRetryAttempt(retryAttempt: number) {
    const attempt = Math.max(0, Math.min(Math.floor(retryAttempt), 4));
    return Math.min(
        CHAT_RETRY_TIMEOUT_BASE_MS + attempt * CHAT_RETRY_TIMEOUT_STEP_MS,
        CHAT_RETRY_TIMEOUT_MAX_MS,
    );
}

function nextChatRetryAttempt(retryAttempt: number) {
    return Math.min(Math.max(0, Math.floor(retryAttempt)) + 1, 4);
}

function isRetryableChatTurnError(message: string) {
    const code = readChatErrorCode(message);
    return code.endsWith("_timeout") || code.includes("timeout");
}
