/**
 * Final chat prompt assembly.
 *
 * Combines system instructions, core comms identity, bounded memory/document blocks,
 * recent conversation, and the current user message into provider-ready messages.
 */
import type { ChatMessage } from "@sivraj/llm";
import type { ChatMemoryContext, ChatMessageRow } from "../../types/chat.types.js";
import { truncate } from "./helpers.js";
import {
  fallbackConversationContextResolution,
  selectMeaningfulConversationMessages,
} from "./conversation-context.js";
import { classifyMemoryContent } from "./memory-request.js";
import type {
  ConversationContextResolution,
  CoreCommsContext,
  DocumentContext,
  DocumentInspectionSource,
  DocumentRetrievalPlan,
} from "./turn-types.js";

const CHAT_MEMORY_CONTEXT_CHAR_LIMIT = 900;
const CHAT_DOCUMENT_CONTEXT_CHAR_LIMIT = 1_200;

const SKIPPED_DOCUMENT_RETRIEVAL_PLAN: DocumentRetrievalPlan = {
  source: "skipped",
  mode: "general_chat",
  inspectionMode: "semantic_passages",
  task: "answer",
  target: { kind: "none" },
  artifactIds: [],
  targetPages: [],
  confidence: 0,
  needsClarification: false,
};

export type BuildPromptMessagesInput = {
  currentMessage: string;
  contextResolution?: ConversationContextResolution;
  coreCommsContext: CoreCommsContext;
  memoryContext: ChatMemoryContext;
  documentContext?: Pick<DocumentContext, "passages" | "inspectionSources" | "retrievalPlan" | "degradation"> | null;
  recentMessages: ChatMessageRow[];
  excludeMessageIds?: Set<string>;
  providerLabel: string;
};

/** Build the message array sent to the response LLM for one turn. */
export function buildPromptMessages(input: BuildPromptMessagesInput): ChatMessage[] {
  const memoryBlock = input.memoryContext.results.length > 0
    ? input.memoryContext.results
        .map((result, index) => formatMemoryPromptBlock(result, index))
        .join("\n\n")
    : "No relevant memory context for this turn.";
  const documentInspectionBlock = formatDocumentInspectionSources(
    input.documentContext?.inspectionSources ?? [],
  );
  const documentBlock = input.documentContext?.passages.length
    ? input.documentContext.passages
        .map(
          (passage, index) => `[DOC_${index + 1}] ${truncate(passage.content, CHAT_DOCUMENT_CONTEXT_CHAR_LIMIT)}\nsourceArtifactId=${passage.sourceArtifactId}; chunk=${passage.chunkIndex}${formatPageRangeInline(passage.pageStart, passage.pageEnd)}`,
        )
        .join("\n\n")
    : "No relevant document passages for this turn.";
  const documentPlanBlock = JSON.stringify(
    input.documentContext?.retrievalPlan ?? SKIPPED_DOCUMENT_RETRIEVAL_PLAN,
  );
  const documentRetrievalStatusBlock = formatDocumentRetrievalStatus(input.documentContext ?? null);
  const conversationResolution = input.contextResolution
    ?? fallbackConversationContextResolution(input.currentMessage);
  const coreCommsBlock = formatCoreCommsContext(input.coreCommsContext);
  const excludeMessageIds = input.excludeMessageIds ?? new Set();
  const recent = selectMeaningfulConversationMessages(input.recentMessages, excludeMessageIds)
    .slice(-10)
    .map((message) => ({
      role: message.role,
      content: message.content,
    }));

  return [
    {
      role: "system",
      content: [
        "You are the response model for Sivraj, a persistent user-owned memory layer.",
        "Speak as the assistant named in core comms context, using first person when referring to yourself.",
        "Do not introduce Sivraj, explain what Sivraj is, or refer to the assistant in the third person.",
        "Do not mention missing memory, empty memory, [MEM_NONE], onboarding, setup, or product capabilities unless the user asks.",
        "Core comms context is authoritative profile data. Use it directly for identity questions, including the user's name and your assistant name.",
        "When answering a user profile fact, speak to the user: say 'you are', 'your name is', or 'you prefer'. Never turn a user fact into 'I am' unless the saved fact explicitly describes the assistant.",
        "Sivraj memory is user-owned context, not global truth. It is authoritative for the user's saved facts, preferences, prior statements, and private history; it is not authoritative for objective public knowledge unless the user explicitly asks for their saved version.",
        "Use retrieved memory only when the resolved intent asks for memory, personal context, prior user statements, or the user's saved version of a topic.",
        "When answering from memory about a public topic, frame it as saved user context with language like 'you told me' or 'I have saved', not as objective truth.",
        "Memory labels like [MEM_1] are internal grounding markers; never include them in user-facing text.",
        "For memory inventory or follow-up requests, summarize the provided core comms and memory context in natural language. If some memories were already mentioned in recent conversation, say 'besides that' and list only other provided facts when possible.",
        "Do not mix engineering or agent-specific memories into a personal 'about me' answer unless the resolved memoryRequest scope is engineering or all. If engineering memories are provided for an all-memory request, label them as coding/work preferences.",
        "When document inspection sources are available, use them as primary document evidence. Page-range inspection sources are authoritative for questions about those pages.",
        "Metadata-only document inspection sources prove that a document record exists; they do not prove readable access to the document body. Do not claim you can access or summarize a PDF unless page, scan, or passage text is provided.",
        "When exact-search or query-scan inspection reports are available, use their reported counts and evidence directly for broad document questions such as occurrence counts, structure, summaries, and details across a resolved span.",
        "When only document source passages are available, answer only from those passages and their page ranges.",
        "If document retrieval status is degraded, do not say the user never sent a document. Say the document is saved but temporarily unreadable, and ask the user to retry.",
        "For document questions, do not add plausible details that are not present in document inspection sources or document source passages. If the provided document evidence does not contain the answer, say you do not have enough information from the uploaded document.",
        "Document labels like [DOC_1] are internal grounding markers; never include them in user-facing text.",
        "Use resolved conversation context to understand follow-up references. When standaloneQuery differs from the raw user message, answer the standaloneQuery while preserving the user's intent.",
        "If the user asks for a specific personal memory and the provided core comms or memory context does not contain that fact, say you do not have that memory yet. Do not use this missing-memory phrasing for inventory questions when any core comms or memory context is available.",
        "If the user gives an ambiguous statement or instruction that has no clear action and is not answerable as general knowledge, briefly say what part you are not sure how to use, reference their wording, and ask what they want done with it.",
        "Normal general-knowledge questions, creative tasks, coding tasks, explanations, and reasoning requests should be answered directly from the model unless the user specifically asks for private memory or document evidence.",
        "For short greetings or empty-context starts, answer naturally with a concise question such as: What can I help you with today?",
        `Current model provider: ${input.providerLabel}.`,
        "",
        "Core comms context:",
        coreCommsBlock,
        "",
        "Resolved conversation context:",
        JSON.stringify(conversationResolution),
        "",
        "Sivraj memory context:",
        memoryBlock,
        "",
        "Document inspection sources:",
        documentInspectionBlock,
        "",
        "Document source passages:",
        documentBlock,
        "",
        "Document retrieval plan:",
        documentPlanBlock,
        "",
        "Document retrieval status:",
        documentRetrievalStatusBlock,
      ].join("\n"),
    },
    ...recent,
    { role: "user", content: formatCurrentUserPrompt(input.currentMessage, conversationResolution) },
  ];
}

function formatDocumentRetrievalStatus(
  documentContext: Pick<DocumentContext, "passages" | "inspectionSources" | "degradation"> | null,
): string {
  if (documentContext?.degradation) {
    return JSON.stringify({
      state: "degraded",
      reason: documentContext.degradation.reason,
      message: documentContext.degradation.message,
      artifactIds: documentContext.degradation.artifactIds,
      failureCount: documentContext.degradation.failureCount,
    });
  }
  if ((documentContext?.passages.length ?? 0) > 0 || (documentContext?.inspectionSources.length ?? 0) > 0) {
    return JSON.stringify({ state: "retrieved" });
  }
  return JSON.stringify({ state: "not_available_for_turn" });
}

function formatMemoryPromptBlock(
  result: BuildPromptMessagesInput["memoryContext"]["results"][number],
  index: number,
) {
  const content = truncate(result.memory.content, CHAT_MEMORY_CONTEXT_CHAR_LIMIT);
  return [
    `[MEM_${index + 1}]`,
    `memoryKind=${classifyMemoryContent(result.memory.content)}`,
    "subject=user unless content explicitly says otherwise",
    `score=${result.score}`,
    `sourceArtifactId=${result.memory.sourceArtifactId}`,
    "content:",
    content,
  ].join("\n");
}

export function formatCurrentUserPrompt(
  currentMessage: string,
  contextResolution: ConversationContextResolution,
): string {
  if (
    contextResolution.standaloneQuery.trim().length === 0
    || contextResolution.standaloneQuery.trim() === currentMessage.trim()
  ) {
    return currentMessage;
  }
  return [
    `Original user message: ${currentMessage}`,
    `Resolved standalone query to answer: ${contextResolution.standaloneQuery}`,
  ].join("\n");
}

function formatDocumentInspectionSources(sources: DocumentInspectionSource[]): string {
  if (sources.length === 0) {
    return "No document inspection sources for this turn.";
  }
  return sources
    .map((source, index) => {
      const header = [
        formatDocumentInspectionLabel(source.scope, index),
        source.title ? `title=${source.title}` : null,
        source.fileName ? `fileName=${source.fileName}` : null,
        source.pageCount ? `pageCount=${source.pageCount}` : null,
        source.pageStart ? `pageStart=${source.pageStart}` : null,
        source.pageEnd ? `pageEnd=${source.pageEnd}` : null,
        `sourceArtifactId=${source.sourceArtifactId}`,
        `sourceType=${source.sourceType}`,
        `charCount=${source.charCount}`,
        `includedFullText=${source.includedFullText}`,
      ].filter(Boolean).join("; ");
      return source.includedFullText
        ? `${header}\n${source.content}`
        : `${header}\nFull text omitted from this turn because the document exceeds the inspection budget. Use document source passages only.`;
    })
    .join("\n\n");
}

function formatDocumentInspectionLabel(scope: DocumentInspectionSource["scope"], index: number): string {
  if (scope === "metadata") {
    return `[DOC_META_${index + 1}]`;
  }
  if (scope === "page_range") {
    return `[DOC_PAGE_${index + 1}]`;
  }
  return `[DOC_SCAN_${index + 1}]`;
}

function formatPageRangeInline(pageStart: number | null, pageEnd: number | null): string {
  if (!pageStart) {
    return "";
  }
  return pageEnd && pageEnd !== pageStart
    ? `; pages=${pageStart}-${pageEnd}`
    : `; page=${pageStart}`;
}

export function formatCoreCommsContext(coreCommsContext: CoreCommsContext): string {
  const lines = [
    coreCommsContext.assistantName
      ? `Assistant name: ${coreCommsContext.assistantName}`
      : null,
    coreCommsContext.displayName
      ? `User display name: ${coreCommsContext.displayName}`
      : null,
    coreCommsContext.aliases.length > 0
      ? `User aliases: ${coreCommsContext.aliases.join(", ")}`
      : null,
    coreCommsContext.emails.length > 0
      ? `User emails: ${coreCommsContext.emails.join(", ")}`
      : null,
    coreCommsContext.phones.length > 0
      ? `User phones: ${coreCommsContext.phones.join(", ")}`
      : null,
    formatHandles(coreCommsContext.handles),
  ].filter((line): line is string => Boolean(line));
  return lines.length > 0 ? lines.join("\n") : "No saved core comms facts.";
}

export function formatHandles(handles: Record<string, unknown> | null | undefined): string | null {
  if (!handles) {
    return null;
  }
  const values = Object.entries(handles)
    .flatMap(([kind, rawValues]) => {
      if (!Array.isArray(rawValues)) {
        return [];
      }
      return rawValues
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        .map((value) => `${kind}: ${value.trim()}`);
    });
  return values.length > 0 ? `Handles: ${values.join(", ")}` : null;
}
