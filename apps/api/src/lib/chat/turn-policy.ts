/**
 * Turn policy — pure decision functions that branch chat orchestration.
 *
 * Each `should*` helper reads {@link ConversationContextResolution} plus memory intent
 * and intake outcome to choose fast paths (private ack, intake ack, missing-memory reply)
 * or full retrieval + generation.
 */
import { retrieveRelevantMemories } from "@sivraj/retrieval";
import type { ChatMemoryIntent, MemoryIntakeResult } from "./memory-intake.js";
import type { ConversationContextResolution, CoreCommsContext, DocumentContext } from "./turn-types.js";

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
  contextResolution: Pick<ConversationContextResolution, "intent" | "retrieval"> | undefined,
  _query?: string,
): boolean {
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

/** Short-circuit with a voice reply when memory QA finds no matching hot memory. */
export function shouldFastReplyMissingMemory(input: {
  query: string;
  contextResolution?: Pick<ConversationContextResolution, "retrieval" | "answerTarget" | "intent"> | null;
  coreCommsContext: CoreCommsContext;
  memoryContext: PolicyMemoryContext;
  documentContext?: DocumentContext;
}): boolean {
  if (input.memoryContext.results.length > 0) {
    return false;
  }

  if (
    (input.documentContext?.passages.length ?? 0) > 0 ||
    (input.documentContext?.inspectionSources.length ?? 0) > 0
  ) {
    return false;
  }

  return input.contextResolution?.retrieval === "hot_memory" ||
    input.contextResolution?.answerTarget === "memory" ||
    input.contextResolution?.intent === "memory_qa";
}
