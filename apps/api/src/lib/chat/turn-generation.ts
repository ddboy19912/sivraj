/**
 * Non-streaming chat turn generation.
 *
 * Loads memory and document context when the planner requests it, builds the prompt,
 * calls the provider once, and returns citations, usage, and a semantic title candidate.
 */
import { createOpenAICompatibleChatGenerator } from "@sivraj/llm";
import type { ApiDb } from "../../app.js";
import type {
  ChatMemoryContext,
  ChatMemoryIntent,
  ChatRuntimeConfig,
} from "../../types/chat.types.js";
import { readRecord } from "../http/route-helpers.js";
import { loadThreadMessages, readPositiveInteger } from "./helpers.js";
import { resolveConversationContext } from "./conversation-context.js";
import { buildPromptMessages } from "./prompt-builder.js";
import {
  emptyDocumentContext,
  loadDocumentContextForIntent,
  shouldLoadDocumentContext,
} from "./document-retrieval.js";
import { loadTurnPlanningMemoryHints } from "./current-truth.js";
import {
  emptyMemoryContext,
  loadMemoryContext,
} from "./memory-retrieval.js";
import { estimateMemoryTokenSavings } from "./token-accounting.js";
import { sanitizeAssistantContent } from "./chat-sanitize.js";
import { generateSemanticChatTitle } from "./thread-title.js";
import {
  resolveCoreCommsAnswer,
  shouldFastReplyMissingMemory,
  shouldLoadMemoryContext,
} from "./turn-policy.js";
import { generateSivrajVoiceReply } from "./voice-reply.js";
import { loadCachedCoreCommsContext } from "./chat-cache.js";
import type { ConversationContextResolution, DocumentContext } from "./turn-types.js";
import type { MemorySearchConfig } from "@sivraj/config";
import type { AppDependencies } from "../../app.js";

export type GenerateChatTurnInput = {
  db: ApiDb;
  privateMemoryReader: AppDependencies["privateMemoryReader"];
  llmFetch: AppDependencies["llmFetch"];
  memorySearchConfig: MemorySearchConfig;
  twinId: string;
  threadId: string;
  content: string;
  runtimeConfig: ChatRuntimeConfig;
  memoryIntent?: ChatMemoryIntent;
  coreCommsContext?: Awaited<ReturnType<typeof loadCachedCoreCommsContext>>;
  planningMemoryHints?: Awaited<ReturnType<typeof loadTurnPlanningMemoryHints>>;
  recentMessages?: Awaited<ReturnType<typeof loadThreadMessages>>;
  contextResolution?: ConversationContextResolution;
  excludeMessageIds?: Set<string>;
};

/** Generate a complete assistant turn for the legacy non-streaming message endpoint. */
export async function generateChatTurn(input: GenerateChatTurnInput) {
  const recentMessages =
    input.recentMessages ??
    (await loadThreadMessages(
      input.db,
      input.twinId,
      input.threadId,
      readPositiveInteger(process.env["CHAT_RECENT_RAW_MESSAGE_LIMIT"], 48),
    ));
  const planningMemoryHints =
    input.planningMemoryHints ??
    (await loadTurnPlanningMemoryHints(input.db, input.twinId));
  const contextResolution =
    input.contextResolution ??
    (await resolveConversationContext({
      currentMessage: input.content,
      recentMessages,
      excludeMessageIds: input.excludeMessageIds ?? new Set(),
      memoryIntent: input.memoryIntent ?? "auto",
      coreCommsContext: input.coreCommsContext,
      memoryHints: planningMemoryHints,
      runtimeConfig: input.runtimeConfig,
      llmFetch: input.llmFetch,
    }));
  const retrievalQuery = contextResolution.standaloneQuery;
  const coreCommsContext =
    input.coreCommsContext ??
    (await loadCachedCoreCommsContext(input.db, input.twinId));
  const coreCommsAnswer =
    resolveCoreCommsAnswer(input.content, coreCommsContext) ??
    resolveCoreCommsAnswer(retrievalQuery, coreCommsContext);
  if (coreCommsAnswer) {
    return buildStaticAssistantTurn({
      content: coreCommsAnswer.content,
      runtimeConfig: input.runtimeConfig,
      contextResolution,
    });
  }
  const shouldLoadMemory = shouldLoadMemoryContext(contextResolution, retrievalQuery);
  const shouldLoadDocument = shouldLoadDocumentContext(contextResolution);
  const memoryContextPromise = shouldLoadMemory
    ? loadMemoryContext({
        db: input.db,
        privateMemoryReader: input.privateMemoryReader,
        memorySearchConfig: input.memorySearchConfig,
        twinId: input.twinId,
        query: retrievalQuery,
        contextResolution,
        runtimeConfig: input.runtimeConfig,
        llmFetch: input.llmFetch,
      })
    : Promise.resolve(emptyMemoryContext());
  const documentContextPromise = shouldLoadDocument
    ? loadDocumentContextForIntent({
        db: input.db,
        privateMemoryReader: input.privateMemoryReader,
        twinId: input.twinId,
        threadId: input.threadId,
        query: retrievalQuery,
        contextResolution,
        runtimeConfig: input.runtimeConfig,
        llmFetch: input.llmFetch,
      })
    : Promise.resolve(emptyDocumentContext());
  const [memoryContext, documentContext] = await Promise.all([
    memoryContextPromise,
    documentContextPromise,
  ]);
  if (
    shouldFastReplyMissingMemory({
      query: retrievalQuery,
      contextResolution,
      coreCommsContext,
      memoryContext,
      documentContext,
    })
  ) {
    return buildStaticAssistantTurn({
      content: await generateSivrajVoiceReply({
        kind: "missing_memory",
        userMessage: retrievalQuery,
        runtimeConfig: input.runtimeConfig,
        llmFetch: input.llmFetch,
        assistantName: coreCommsContext.assistantName,
      }),
      runtimeConfig: input.runtimeConfig,
      contextResolution,
    });
  }
  const promptMessages = buildPromptMessages({
    currentMessage: input.content,
    contextResolution,
    coreCommsContext,
    memoryContext,
    documentContext,
    recentMessages,
    excludeMessageIds: input.excludeMessageIds ?? new Set(),
    providerLabel: input.runtimeConfig.displayName,
  });
  const output = await createOpenAICompatibleChatGenerator({
    provider: input.runtimeConfig.providerKind,
    apiKey: input.runtimeConfig.apiKey,
    model: input.runtimeConfig.model,
    baseUrl: input.runtimeConfig.baseUrl,
    fetch: input.llmFetch,
    timeoutMs: readPositiveInteger(process.env["LLM_REQUEST_TIMEOUT_MS"], 30_000),
  }).generateChat({
    messages: promptMessages,
    temperature: 0.2,
  });
  const sanitizedOutput = {
    ...output,
    content: sanitizeAssistantContent(output.content),
  };
  const citations = buildCitations(memoryContext, documentContext);
  const usage = readRecord(output.metadata?.usage);
  const tokenSavings = estimateMemoryTokenSavings(memoryContext);
  const title = await generateSemanticChatTitle({
    userMessage: input.content,
    assistantMessage: sanitizedOutput.content,
    memoryContext,
    runtimeConfig: input.runtimeConfig,
    llmFetch: input.llmFetch,
  });
  return {
    output: sanitizedOutput,
    memoryContext,
    documentContext,
    contextResolution,
    citations,
    usage,
    tokenSavings,
    title,
  };
}

/** Build a turn result without LLM generation (fast-path acks and voice replies). */
export function buildStaticAssistantTurn(input: {
  content: string;
  runtimeConfig: ChatRuntimeConfig;
  contextResolution: ConversationContextResolution;
}) {
  const memoryContext = emptyMemoryContext();
  const documentContext = emptyDocumentContext();
  const citations = buildCitations(memoryContext, documentContext);
  const usage = {};
  const tokenSavings = estimateMemoryTokenSavings(memoryContext);
  return {
    output: {
      content: input.content,
      provider: input.runtimeConfig.providerKind,
      model: input.runtimeConfig.model,
      metadata: { usage },
    },
    memoryContext,
    documentContext,
    contextResolution: input.contextResolution,
    citations,
    usage,
    tokenSavings,
    title: {
      status: "failed" as const,
      errorMessage: "static_assistant_reply",
    },
  };
}

/** Merge memory and document hits into UI/API citation labels (`MEM_n`, `DOC_n`). */
export function buildCitations(
  memoryContext: ChatMemoryContext,
  documentContext: { passages: DocumentContext["passages"] },
) {
  const memoryCitations = memoryContext.results.map((result, index) => ({
    id: result.memory.id,
    label: `MEM_${index + 1}`,
    sourceArtifactId: result.memory.sourceArtifactId,
    score: result.score,
    matchedTerms: result.matchedTerms,
  }));
  const documentCitations =
    documentContext?.passages.map((passage, index) => ({
      id: passage.id,
      label: `DOC_${index + 1}`,
      sourceArtifactId: passage.sourceArtifactId,
      score: passage.score,
      matchedTerms: passage.matchedTerms,
    })) ?? [];
  return [...memoryCitations, ...documentCitations];
}
