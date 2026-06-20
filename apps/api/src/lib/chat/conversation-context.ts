/**
 * Conversation turn planner — resolves user intent before retrieval and generation.
 *
 * `resolveConversationContext` calls a lightweight LLM to produce a
 * {@link ConversationContextResolution}. On timeout or parse failure it falls back
 * to {@link fallbackConversationContextResolution}.
 */
import { createOpenAICompatibleChatGenerator } from "@sivraj/llm";
import type { ChatMessageRow, ChatRuntimeConfig } from "../../types/chat.types.js";
import { optionalString } from "../http/route-helpers.js";
import { errorMessage, readPositiveInteger, truncate } from "./helpers.js";
import { clampConfidence, parseJsonObject } from "./chat-json.js";
import type { ChatMemoryIntent } from "./memory-intake.js";
import type {
  ConversationContextResolution,
  CoreCommsContext,
  TurnPlanningMemoryHint,
} from "./turn-types.js";

export type ResolveConversationContextInput = {
  currentMessage: string;
  recentMessages: ChatMessageRow[];
  excludeMessageIds?: Set<string>;
  memoryIntent?: ChatMemoryIntent;
  coreCommsContext?: CoreCommsContext | null;
  memoryHints?: TurnPlanningMemoryHint[];
  runtimeConfig: ChatRuntimeConfig;
  llmFetch?: typeof fetch;
  contextResolveTimeoutMs?: number;
};

const CONVERSATION_CONTEXT_RESOLVER_SYSTEM_PROMPT = [
  "You are Sivraj's turn intelligence planner.",
  "Read the current user message and recent conversation, then decide what the backend should do before the response model runs.",
  "Use natural language understanding. Do not rely on fixed keywords; infer whether the user is asking, teaching, commanding, referring to memory, referring to documents, or just chatting.",
  "Use the recent conversation only to resolve references, omitted subjects, or follow-up intent. Do not answer the user.",
  "Return only JSON with shape {\"standaloneQuery\":\"string\",\"intent\":\"document_qa|memory_qa|conversation_reference|general_chat|ambiguous\",\"turnKind\":\"question|statement|command|mixed\",\"answerTarget\":\"general|memory|document|conversation|none\",\"memoryWrite\":\"skip|extract|force_note\",\"retrieval\":\"none|hot_memory|document|conversation_context\",\"confidence\":0.0,\"referencedMessageIds\":[\"id\"],\"reason\":\"short\"}.",
  "If the current message is already standalone, use it unchanged as standaloneQuery.",
  "When memoryWrite is extract or force_note, standaloneQuery must be the exact standalone memory statement to store, with references like 'it', 'that', or 'this' resolved from recentConversation.",
  "Example: if the user first says 'The odd launch rule is that velvet buttons must stay blue' and later says 'Just remember it', return standaloneQuery 'The odd launch rule is that velvet buttons must stay blue', memoryWrite extract or force_note, retrieval none, answerTarget none.",
  "If the user explicitly says to remember, save, keep, or make a note of something, set memoryWrite extract or force_note unless memoryIntent is private.",
  "answerTarget describes what kind of answer is needed. Use none when the best response is just an acknowledgement.",
  "retrieval describes the external context needed before answering. Use none for normal model knowledge and pure memory-intake turns.",
  "memoryWrite describes whether Sivraj should store information from this message. Use extract for durable personal facts, preferences, useful notes, user skills, coding preferences, code references, project conventions, architecture decisions, testing practices, deployment/runtime facts, security boundaries, recurring bugs, or coding-agent instructions. Use force_note only when the user explicitly intends the message to be remembered and it is not a clean structured memory.",
  "memoryHints lists approved hot memories already saved for this twin. Use it as a memory map for planning, not as final answer text.",
  "If the current message asks about, refers to, or follows up on one of memoryHints, including engineering memories, user skills, code references, or project notes, set intent memory_qa, answerTarget memory, retrieval hot_memory.",
  "For non-public named notes, rules, protocols, project notes, private codes, preferences, and user-specific labels that match memoryHints, prefer memory_qa over general_chat.",
  "Do not use memory just because a hint mentions a public topic. Normal public-knowledge questions stay general_chat unless the user asks for their saved/personal version.",
  "The UI memory mode is advisory except private is a hard privacy boundary: private means memoryWrite must be skip, but retrieval may still be hot_memory/document/conversation_context if the user asks for existing context.",
  "In remember mode, if the message is a normal question or task, answer it normally and set memoryWrite skip unless the message also contains new durable memory or engineering context.",
  "In remember mode, if the message is primarily a statement to remember, set memoryWrite extract or force_note and retrieval none.",
  "If coreCommsContext already contains the needed identity fact, such as the user's display name or the assistant's name, set answerTarget general and retrieval none.",
  "Use general_chat for normal world knowledge, coding, explanations, brainstorming, or creative tasks that do not require Sivraj memory or uploaded documents.",
  "Use memory_qa only when the user asks about saved personal facts, preferences, prior memories, or things they expect Sivraj to remember beyond the current chat.",
  "Use memory_qa for questions like 'what did I tell you about X', 'what do I believe about X', 'what is my definition of X', or 'use my saved version of X', even when X is normally a public topic.",
  "Use document_qa only when the user asks about uploaded files, PDFs, documents, pages, chapters, passages, or document-derived knowledge.",
  "Use conversation_reference when the user refers to a previous message in the current thread and does not need durable memory or document evidence.",
  "Only include referencedMessageIds from the provided recentConversation list.",
  "Preserve sensitive values exactly when they are required to retrieve the user's private memory; do not invent facts.",
].join("\n");

/**
 * Classify the current message: standalone query, retrieval needs, and memory write intent.
 */
export async function resolveConversationContext(
  input: ResolveConversationContextInput,
): Promise<ConversationContextResolution> {
  const meaningfulRecentMessages = selectMeaningfulConversationMessages(
    input.recentMessages,
    input.excludeMessageIds ?? new Set(),
  ).slice(-14);
  const timeoutMs = input.contextResolveTimeoutMs
    ?? readPositiveInteger(process.env["CHAT_CONTEXT_RESOLVE_TIMEOUT_MS"], 30_000);

  try {
    const output = await createOpenAICompatibleChatGenerator({
      provider: input.runtimeConfig.providerKind,
      apiKey: input.runtimeConfig.apiKey,
      model: input.runtimeConfig.model,
      baseUrl: input.runtimeConfig.baseUrl,
      fetch: input.llmFetch,
      timeoutMs,
      maxRetries: 0,
    }).generateChat({
      temperature: 0,
      timeoutMs,
      messages: [
        {
          role: "system",
          content: CONVERSATION_CONTEXT_RESOLVER_SYSTEM_PROMPT,
        },
        {
          role: "user",
          content: JSON.stringify({
            currentMessage: input.currentMessage,
            memoryIntent: input.memoryIntent ?? "auto",
            coreCommsContext: input.coreCommsContext
              ? {
                  hasUserDisplayName: Boolean(input.coreCommsContext.displayName),
                  hasAssistantName: Boolean(input.coreCommsContext.assistantName),
                }
              : null,
            memoryHints: (input.memoryHints ?? []).map((hint) => ({
              id: hint.id,
              label: hint.label,
              kind: hint.kind,
              slot: hint.slot,
              qualifier: hint.qualifier,
              value: hint.value,
              sourceMessagePreview: hint.sourceMessagePreview,
              updatedAt: hint.updatedAt,
            })),
            recentConversation: meaningfulRecentMessages.map((message) => ({
              id: message.id,
              role: message.role,
              content: truncate(message.content, 1_200),
              createdAt: message.createdAt.toISOString(),
            })),
          }),
        },
      ],
    });
    return readConversationContextResolution(
      output.content,
      input.currentMessage,
      meaningfulRecentMessages,
    );
  } catch (error) {
    console.warn("chat conversation context resolution failed", {
      error: errorMessage(error),
    });
    return fallbackConversationContextResolution(input.currentMessage);
  }
}

export function readConversationContextResolution(
  content: string,
  currentMessage: string,
  recentMessages: ChatMessageRow[],
): ConversationContextResolution {
  const parsed = parseJsonObject(content);
  const allowedIds = new Set(recentMessages.map((message) => message.id));
  const referencedMessageIds = Array.isArray(parsed?.["referencedMessageIds"])
    ? parsed["referencedMessageIds"].filter(
        (id): id is string => typeof id === "string" && allowedIds.has(id),
      )
    : [];
  const standaloneQuery = optionalString(parsed?.["standaloneQuery"]) ?? currentMessage;
  const intent = readConversationIntent(parsed?.["intent"]);
  const answerTarget = readAnswerTarget(parsed?.["answerTarget"], intent);
  const retrieval = readRetrievalDecision(parsed?.["retrieval"], intent, answerTarget);

  return {
    source: "llm",
    standaloneQuery: truncate(standaloneQuery, 2_000),
    intent,
    turnKind: readTurnKind(parsed?.["turnKind"]),
    answerTarget,
    memoryWrite: readMemoryWriteDecision(parsed?.["memoryWrite"]),
    retrieval,
    confidence: clampConfidence(parsed?.["confidence"]),
    referencedMessageIds: Array.from(new Set(referencedMessageIds)),
    reason: optionalString(parsed?.["reason"])?.slice(0, 200),
  };
}

function readConversationIntent(value: unknown): ConversationContextResolution["intent"] {
  return value === "document_qa"
    || value === "memory_qa"
    || value === "conversation_reference"
    || value === "general_chat"
    || value === "ambiguous"
    ? value
    : "ambiguous";
}

function readTurnKind(value: unknown): ConversationContextResolution["turnKind"] {
  return value === "question"
    || value === "statement"
    || value === "command"
    || value === "mixed"
    ? value
    : "mixed";
}

function readAnswerTarget(
  value: unknown,
  intent: ConversationContextResolution["intent"],
): ConversationContextResolution["answerTarget"] {
  if (
    value === "general"
    || value === "memory"
    || value === "document"
    || value === "conversation"
    || value === "none"
  ) {
    return value;
  }
  if (intent === "memory_qa") {
    return "memory";
  }
  if (intent === "document_qa") {
    return "document";
  }
  if (intent === "conversation_reference") {
    return "conversation";
  }
  return intent === "general_chat" ? "general" : "general";
}

function readMemoryWriteDecision(value: unknown): ConversationContextResolution["memoryWrite"] {
  return value === "extract" || value === "force_note" ? value : "skip";
}

function readRetrievalDecision(
  value: unknown,
  intent: ConversationContextResolution["intent"],
  answerTarget: ConversationContextResolution["answerTarget"],
): ConversationContextResolution["retrieval"] {
  if (
    value === "none"
    || value === "hot_memory"
    || value === "document"
    || value === "conversation_context"
  ) {
    return value;
  }
  if (intent === "memory_qa" || answerTarget === "memory") {
    return "hot_memory";
  }
  if (intent === "document_qa" || answerTarget === "document") {
    return "document";
  }
  if (intent === "conversation_reference" || answerTarget === "conversation") {
    return "conversation_context";
  }
  return "none";
}

/** Deterministic planner used when the LLM resolver fails or provider is unavailable. */
export function fallbackConversationContextResolution(
  currentMessage: string,
): ConversationContextResolution {
  return {
    source: "fallback",
    standaloneQuery: truncate(currentMessage, 2_000),
    intent: "ambiguous",
    turnKind: "mixed",
    answerTarget: "general",
    memoryWrite: "skip",
    retrieval: "none",
    confidence: 0,
    referencedMessageIds: [],
    reason: "resolver_unavailable_no_semantic_fallback",
  };
}

export function selectMeaningfulConversationMessages(
  messages: ChatMessageRow[],
  excludeMessageIds: Set<string> = new Set(),
): ChatMessageRow[] {
  return messages.filter((message) => !excludeMessageIds.has(message.id)
    && (message.role === "user" || message.role === "assistant")
    && (message.status === "completed" || message.status === "streaming")
    && message.content.trim().length > 0);
}
