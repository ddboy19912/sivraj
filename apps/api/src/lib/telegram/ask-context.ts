import type {
  ChatMessageRow,
  ChatRuntimeConfig,
  CoreCommsContext,
} from "../../types/chat.types.js";
import { resolveConversationContext } from "../chat/conversation-context.js";
import type {
  ConversationContextResolution,
  TurnPlanningMemoryHint,
} from "../chat/turn-types.js";

export type ResolveTelegramAskContextResolutionInput = {
  currentMessage: string;
  recentMessages: ChatMessageRow[];
  excludeMessageIds?: Set<string>;
  coreCommsContext?: CoreCommsContext | null;
  memoryHints?: TurnPlanningMemoryHint[];
  runtimeConfig: ChatRuntimeConfig;
  llmFetch?: typeof fetch;
};

export async function resolveTelegramAskContextResolution(
  input: ResolveTelegramAskContextResolutionInput,
): Promise<ConversationContextResolution> {
  const contextResolution = await resolveConversationContext({
    currentMessage: input.currentMessage,
    recentMessages: input.recentMessages,
    excludeMessageIds: input.excludeMessageIds ?? new Set(),
    memoryIntent: "private",
    coreCommsContext: input.coreCommsContext,
    memoryHints: input.memoryHints,
    runtimeConfig: input.runtimeConfig,
    llmFetch: input.llmFetch,
  });

  return coerceTelegramAskDocumentContext({
    currentMessage: input.currentMessage,
    recentMessages: input.recentMessages,
    excludeMessageIds: input.excludeMessageIds ?? new Set(),
    contextResolution,
  });
}

export function coerceTelegramAskDocumentContext(input: {
  currentMessage: string;
  recentMessages: ChatMessageRow[];
  excludeMessageIds?: Set<string>;
  contextResolution: ConversationContextResolution;
}): ConversationContextResolution {
  const documentReference = findRecentDocumentReference(input.recentMessages, input.excludeMessageIds);
  const standaloneQuery = input.contextResolution.standaloneQuery;
  const explicitDocumentAsk =
    mentionsPrivateDocument(input.currentMessage) ||
    mentionsPrivateDocument(standaloneQuery);
  const documentFollowup = Boolean(documentReference) &&
    hasDocumentPronoun(input.currentMessage) &&
    (isDocumentBodyRequest(input.currentMessage) || isDocumentAccessRequest(input.currentMessage));

  if (isDocumentContext(input.contextResolution)) {
    if (documentFollowup && !mentionsPrivateDocument(standaloneQuery) && documentReference) {
      return {
        ...input.contextResolution,
        standaloneQuery: buildDocumentFollowupQuery(input.currentMessage, documentReference),
        reason: appendReason(input.contextResolution.reason, "telegram_document_followup"),
      };
    }

    return input.contextResolution;
  }

  if (!explicitDocumentAsk && !documentFollowup) {
    return input.contextResolution;
  }

  return {
    ...input.contextResolution,
    standaloneQuery: documentFollowup && documentReference
      ? buildDocumentFollowupQuery(input.currentMessage, documentReference)
      : standaloneQuery,
    intent: "document_qa",
    answerTarget: "document",
    memoryWrite: "skip",
    retrieval: "document",
    confidence: Math.max(input.contextResolution.confidence, explicitDocumentAsk ? 0.8 : 0.7),
    memoryRequest: { kind: "none" },
    reason: appendReason(
      input.contextResolution.reason,
      documentFollowup ? "telegram_document_followup" : "telegram_explicit_document_request",
    ),
  };
}

function isDocumentContext(
  contextResolution: Pick<ConversationContextResolution, "intent" | "answerTarget" | "retrieval">,
) {
  return contextResolution.intent === "document_qa" ||
    contextResolution.answerTarget === "document" ||
    contextResolution.retrieval === "document";
}

function mentionsPrivateDocument(message: string) {
  const normalized = normalizeTelegramAskText(message);
  if (!normalized) {
    return false;
  }

  if (/\b[\w ._-]+\.(?:pdf|docx?|md|txt)\b/u.test(normalized)) {
    return true;
  }

  const hasDocumentTerm = /\b(?:pdf|document|file|upload|attachment|source)\b/u.test(normalized);
  const hasPrivateReference =
    /\b(?:my|the|this|that|these|those|uploaded|saved|sent|shared|attached|launch|notes?)\b/u.test(normalized);

  return hasDocumentTerm && hasPrivateReference;
}

function isDocumentBodyRequest(message: string) {
  const normalized = normalizeTelegramAskText(message);

  return /\b(?:summari[sz]e|summary|extract|quote|count|compare|analy[sz]e|explain)\b/u.test(normalized) ||
    /\b(?:what does|what's in|what is in|tell me about|give me|show me)\b/u.test(normalized);
}

function isDocumentAccessRequest(message: string) {
  const normalized = normalizeTelegramAskText(message);

  return /\b(?:do you|can you|could you|are you able to|did i|have i)\b.*\b(?:have|access|see|find|open|read|uploaded|sent|shared|saved)\b/u
    .test(normalized);
}

function hasDocumentPronoun(message: string) {
  return /\b(?:it|this|that|them|the pdf|the document|the file|the upload|the attachment)\b/iu.test(message);
}

function buildDocumentFollowupQuery(message: string, documentReference: string) {
  if (isDocumentBodyRequest(message)) {
    if (/\bsummari[sz]e|summary\b/iu.test(message)) {
      return `Summarize ${documentReference}.`;
    }

    return `${message.trim()} (${documentReference})`;
  }

  if (isDocumentAccessRequest(message)) {
    return `Do you have access to ${documentReference}?`;
  }

  return `${message.trim()} (${documentReference})`;
}

function findRecentDocumentReference(
  recentMessages: ChatMessageRow[],
  excludeMessageIds: Set<string> = new Set(),
) {
  for (const message of [...recentMessages].reverse()) {
    if (excludeMessageIds.has(message.id)) {
      continue;
    }

    const reference = readDocumentReferenceFromContent(message.content);
    if (reference) {
      return reference;
    }
  }

  return null;
}

function readDocumentReferenceFromContent(content: string) {
  const quoted = /["“]([^"”\n]+\.(?:pdf|docx?|md|txt))["”]/iu.exec(content);
  if (quoted?.[1]) {
    return quoted[1].trim();
  }

  const unquoted = /\b([A-Za-z0-9][\w ._-]{1,160}\.(?:pdf|docx?|md|txt))\b/iu.exec(content);
  return unquoted?.[1]?.trim() ?? null;
}

function appendReason(reason: string | undefined, addition: string) {
  return [reason, addition].filter(Boolean).join("; ");
}

function normalizeTelegramAskText(message: string) {
  return message
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s._-]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}
