/**
 * Turn policy — pure decision functions that branch chat orchestration.
 *
 * Each `should*` helper reads {@link ConversationContextResolution} plus memory intent
 * and intake outcome to choose fast paths (private ack, intake ack, missing-memory reply)
 * or full retrieval + generation.
 */
import { retrieveRelevantMemories } from "@sivraj/retrieval";
import type { ChatMemoryIntent, MemoryIntakeResult } from "./memory-intake.js";
import type {
  ChatRetrievalDegradationReason,
  ChatRetrievalStatus,
  ChatRetrievalTarget,
  ConversationContextResolution,
  CoreCommsContext,
  DocumentContext,
} from "./turn-types.js";

type PolicyMemoryContext = {
  results: ReturnType<typeof retrieveRelevantMemories>;
};

/** Skip LLM when hot memory was stored and the turn is a statement with no retrieval need. */
export function shouldFastAcknowledgeMemoryIntake(
  contextResolution: Pick<ConversationContextResolution, "answerTarget" | "memoryWrite" | "retrieval" | "turnKind">,
  memoryIntake: MemoryIntakeResult,
  memoryIntent: ChatMemoryIntent = "auto",
): boolean {
  return memoryIntent !== "private" &&
    storedMemoryCount(memoryIntake) > 0 &&
    contextResolution.memoryWrite !== "skip" &&
    contextResolution.retrieval === "none" &&
    contextResolution.answerTarget === "none" &&
    (contextResolution.turnKind === "statement" || contextResolution.turnKind === "mixed");
}

/** Skip retrieval and memory intake for explicit private disclosures. */
export function shouldFastAcknowledgePrivateDisclosure(
  contextResolution: Pick<ConversationContextResolution, "answerTarget" | "retrieval" | "turnKind">,
  memoryIntent: ChatMemoryIntent,
): boolean {
  return memoryIntent === "private" &&
    contextResolution.retrieval === "none" &&
    contextResolution.answerTarget === "none" &&
    (contextResolution.turnKind === "statement" || contextResolution.turnKind === "mixed");
}

/** Whether durable memory search should run before the response model. */
export function shouldLoadMemoryContext(
  contextResolution: (Pick<ConversationContextResolution, "intent" | "retrieval"> &
    Partial<Pick<ConversationContextResolution, "memoryRequest">>) | undefined,
  _query?: string,
): boolean {
  if (contextResolution?.memoryRequest?.kind && contextResolution.memoryRequest.kind !== "none") {
    return true;
  }

  return contextResolution?.retrieval === "hot_memory" ||
    contextResolution?.intent === "memory_qa";
}

/** Fail the turn when memory intake was required but extraction failed. */
export function shouldInterruptForMemoryIntakeFailure(
  contextResolution: Pick<ConversationContextResolution, "answerTarget" | "memoryWrite" | "retrieval">,
  memoryIntent: ChatMemoryIntent,
  memoryIntake: MemoryIntakeResult,
): boolean {
  if (memoryIntent === "private" || memoryIntake.status !== "failed") {
    return false;
  }

  return contextResolution.memoryWrite !== "skip" &&
    contextResolution.retrieval === "none" &&
    contextResolution.answerTarget === "none";
}

/** Allow verbatim message fallback when LLM intake fails on a write turn. */
export function shouldUseLosslessMemoryFallback(
  contextResolution: Pick<ConversationContextResolution, "memoryWrite">,
  memoryIntent: ChatMemoryIntent,
): boolean {
  if (memoryIntent === "private") {
    return false;
  }

  return contextResolution.memoryWrite !== "skip";
}

/** Whether to run the memory intake classifier before generation. */
export function shouldRunChatMemoryIntake(
  contextResolution: Pick<ConversationContextResolution, "memoryWrite">,
  memoryIntent: ChatMemoryIntent,
): boolean {
  if (memoryIntent === "private") {
    return false;
  }

  return contextResolution.memoryWrite !== "skip";
}

export function memoryIntakeMessageFromTurnPlan(
  currentMessage: string,
  contextResolution: Pick<ConversationContextResolution, "memoryWrite" | "standaloneQuery">,
): string {
  if (contextResolution.memoryWrite === "skip") {
    return currentMessage;
  }

  const resolved = contextResolution.standaloneQuery.trim();
  return resolved.length > 0 ? resolved : currentMessage;
}

export function memoryIntakeIntentFromTurnPlan(
  contextResolution: Pick<ConversationContextResolution, "memoryWrite">,
): Exclude<ChatMemoryIntent, "private"> {
  return contextResolution.memoryWrite === "force_note" ? "remember" : "auto";
}

export function memoryIntakeFailureMessage(memoryIntake: MemoryIntakeResult) {
  return `chat_memory_intake_failed:${memoryIntake.errorMessage ?? "memory intake failed"}`;
}

export function buildMemoryIntakeAcknowledgement(memoryIntake: MemoryIntakeResult): string {
  if (memoryIntake.acknowledgement) {
    return memoryIntake.acknowledgement;
  }

  return storedMemoryCount(memoryIntake) === 1 ? "Got it." : "Got it. I saved those.";
}

export function storedMemoryCount(memoryIntake: Pick<MemoryIntakeResult, "facts" | "engineeringMemories">): number {
  return memoryIntake.facts.length + memoryIntake.engineeringMemories.length;
}

export type CoreCommsAnswerTarget = "assistant_name" | "user_name";

export type CoreCommsAnswer = {
  target: CoreCommsAnswerTarget;
  content: string;
};

export function resolveCoreCommsAnswerTarget(
  query: string,
  coreCommsContext: Pick<CoreCommsContext, "assistantName" | "displayName">,
): CoreCommsAnswerTarget | null {
  const normalized = normalizeIdentityQuery(query);
  if (!normalized) {
    return null;
  }

  if (coreCommsContext.displayName && isUserNameQuestion(normalized)) {
    return "user_name";
  }

  if (coreCommsContext.assistantName && isAssistantNameQuestion(normalized)) {
    return "assistant_name";
  }

  return null;
}

export function resolveCoreCommsAnswer(
  query: string,
  coreCommsContext: Pick<CoreCommsContext, "assistantName" | "displayName">,
): CoreCommsAnswer | null {
  const target = resolveCoreCommsAnswerTarget(query, coreCommsContext);
  if (target === "user_name" && coreCommsContext.displayName) {
    return {
      target,
      content: `Your name is ${coreCommsContext.displayName}.`,
    };
  }

  if (target === "assistant_name" && coreCommsContext.assistantName) {
    return {
      target,
      content: `My name is ${coreCommsContext.assistantName}.`,
    };
  }

  return null;
}

function normalizeIdentityQuery(query: string): string {
  return query
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isUserNameQuestion(query: string): boolean {
  return /\b(?:what(?:'s| is)|do you know|tell me|remind me)\s+(?:my|(?:the\s+)?user'?s)\s+(?:display\s+)?name\b/u.test(query) ||
    /\bmy\s+name\s+(?:is|was)\s+what\b/u.test(query) ||
    /\bwho\s+am\s+i\b/u.test(query) ||
    /\bwho\s+is\s+(?:the\s+)?user\b/u.test(query);
}

function isAssistantNameQuestion(query: string): boolean {
  return /\b(?:what(?:'s| is)|do i know|tell me|remind me)\s+your\s+name\b/u.test(query) ||
    /\bwho\s+are\s+you\b/u.test(query) ||
    /\bwhat\s+should\s+i\s+call\s+you\b/u.test(query);
}

export function shouldFallbackForRetrievalDegradation(
  contextResolution: Pick<ConversationContextResolution, "retrieval" | "answerTarget" | "intent">,
  retrievalStatus: ChatRetrievalStatus,
): boolean {
  if (retrievalStatus.state !== "degraded") {
    return false;
  }

  if (retrievalStatus.target === "memory") {
    return contextResolution.retrieval === "hot_memory" ||
      contextResolution.answerTarget === "memory" ||
      contextResolution.intent === "memory_qa";
  }

  if (retrievalStatus.target === "document") {
    return contextResolution.retrieval === "document" ||
      contextResolution.answerTarget === "document" ||
      contextResolution.intent === "document_qa";
  }

  return false;
}

export function shouldProceedWithPartialRetrieval(input: {
  retrievalStatus: ChatRetrievalStatus;
  memoryContext: PolicyMemoryContext;
  documentContext?: DocumentContext;
}): boolean {
  if (input.retrievalStatus.state !== "degraded") {
    return true;
  }

  if (input.retrievalStatus.target === "memory") {
    return input.memoryContext.results.length > 0;
  }

  if (input.retrievalStatus.target === "document") {
    return (input.documentContext?.passages.length ?? 0) > 0 ||
      (input.documentContext?.inspectionSources.length ?? 0) > 0;
  }

  return false;
}

export function buildRetrievalFallbackReply(
  target: ChatRetrievalTarget,
  _reason: ChatRetrievalDegradationReason | null = null,
): string {
  return target === "document"
    ? "I couldn’t retrieve that document right now, so I can’t answer it safely."
    : "I couldn’t retrieve that memory right now, so I can’t answer it safely.";
}

export function buildEmptyRetrievalFallbackReply(target: ChatRetrievalTarget): string {
  return target === "document"
    ? "I don’t have enough document context to answer that safely."
    : "I don’t have that memory saved yet.";
}
