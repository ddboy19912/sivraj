/**
 * Chat turn persistence — durable message rows, turn lifecycle, and audit trails.
 *
 * Streaming turns use {@link createQueuedTurn} → partial updates → {@link completeStreamingTurn}.
 * Non-streaming turns use {@link insertUserMessage} → {@link persistChatTurn}.
 */
import { auditEvents, chatMessages, chatThreads, chatTurns } from "@sivraj/db";
import { and, eq, inArray } from "drizzle-orm";
import type { ApiDb } from "../../app.js";
import type {
  ChatMemoryIntent,
  ChatMessageRow,
  ChatPersistTurnInput,
  ChatSurface,
  ChatTurnAuditPayload,
  ChatTurnSeed,
  CompleteStreamingTurnInput,
  CreateQueuedTurnInput,
  MarkTurnGeneratingInput,
  MemoryIntakeResult,
  RecordChatMemoryIntakeOutcomeInput,
  RecordCompletedStreamingTurnAuditInput,
} from "../../types/chat.types.js";
import { readRecord } from "../http/route-helpers.js";
import { errorMessage, titleFromMessage, toMessageResponse, type ProviderKind } from "./helpers.js";
import { memoryFragmentIdsFromMemoryContext } from "./memory-fragment-ids.js";
import type { GeneratedChatTitle } from "./turn-types.js";
import { generateSemanticChatTitle, resolveThreadTitleUpdate } from "./thread-title.js";
import { readChatErrorCode } from "./chat-errors.js";

function providerKindForDb(providerKind: string): ProviderKind {
  return providerKind as ProviderKind;
}

/** Insert a completed user message for the non-streaming message endpoint. */
export async function insertUserMessage(
  db: ApiDb,
  twinId: string,
  threadId: string,
  content: string,
  memoryIntent: ChatMemoryIntent = "auto",
  surface: ChatSurface = "web_chat",
): Promise<ChatMessageRow> {
  const [userMessage] = await db
    .insert(chatMessages)
    .values({
      twinId,
      threadId,
      role: "user",
      content,
      status: "completed",
      metadata: {
        contextSaved: memoryIntent !== "private",
        memoryIntent,
        surface,
      },
    })
    .returning();
  return userMessage;
}

/** Create user + pending assistant messages and a queued turn row for SSE streaming. */
export async function createQueuedTurn(input: CreateQueuedTurnInput): Promise<ChatTurnSeed> {
  const surface = input.surface ?? "web_chat";
  const memoryIntent = input.memoryIntent ?? "auto";
  const userMessage = await insertUserMessage(
    input.db,
    input.twinId,
    input.threadId,
    input.content,
    memoryIntent,
    surface,
  );
  const [assistantMessage] = await input.db
    .insert(chatMessages)
    .values({
      twinId: input.twinId,
      threadId: input.threadId,
      role: "assistant",
      status: "pending",
      content: "",
      memoryFragmentIds: [],
      metadata: { surface, streaming: true },
    })
    .returning();
  const [turn] = await input.db
    .insert(chatTurns)
    .values({
      twinId: input.twinId,
      threadId: input.threadId,
      userMessageId: userMessage.id,
      assistantMessageId: assistantMessage.id,
      status: "queued",
      startedAt: new Date(),
      metadata: { surface, memoryIntent },
    })
    .returning();
  await input.db
    .update(chatMessages)
    .set({ turnId: turn.id })
    .where(inArray(chatMessages.id, [userMessage.id, assistantMessage.id]));
  return {
    turn,
    userMessage: { ...userMessage, turnId: turn.id },
    assistantMessage: { ...assistantMessage, turnId: turn.id },
  };
}

/** Persist a completed non-streaming assistant message and record turn audit metadata. */
export async function persistChatTurn(input: ChatPersistTurnInput): Promise<ChatMessageRow> {
  const assistantMessage = await insertAssistantMessage(input);
  await recordChatTurnAudit(input);
  return assistantMessage;
}

async function insertAssistantMessage(input: ChatPersistTurnInput): Promise<ChatMessageRow> {
  const { output, memoryContext, documentContext, contextResolution, citations, usage, tokenSavings } = input.turn;
  const retrievalStatus = input.turn.retrievalStatus;
  const surface = input.surface ?? "web_chat";
  const [assistantMessage] = await input.db
    .insert(chatMessages)
    .values({
      twinId: input.gate.twinId,
      threadId: input.gate.thread.id,
      role: "assistant",
      content: output.content,
      providerKind: providerKindForDb(input.runtimeConfig.providerKind),
      status: "completed",
      model: output.model,
      memoryFragmentIds: memoryFragmentIdsFromMemoryContext(memoryContext, documentContext),
      citations,
      usage,
      metadata: {
        surface,
        providerSource: input.runtimeConfig.source,
        tokenContextSaved: (tokenSavings as { estimatedTokensSaved?: number }).estimatedTokensSaved ?? 0,
        tokenSavings,
        retrievedMemoryCount: memoryContext.results.length,
        documentPassageCount: documentContext?.passages?.length ?? 0,
        documentRetrievalPlan: documentContext?.retrievalPlan,
        contextResolution,
        ...(retrievalStatus ? { retrievalStatus } : {}),
        contextPacket: {
          policy: (documentContext?.passages?.length ?? 0) > 0
            ? "bounded_retrieved_memory_with_document_passages"
            : "bounded_retrieved_memory",
          rawArtifactsIncluded: false,
          resolvedQuery: (contextResolution as { standaloneQuery?: string }).standaloneQuery ?? "",
        },
      },
    })
    .returning();
  return assistantMessage;
}

export async function markTurnRetrievingContext(db: ApiDb, turnId: string): Promise<void> {
  await db
    .update(chatTurns)
    .set({ status: "retrieving_context", updatedAt: new Date() })
    .where(eq(chatTurns.id, turnId));
}

export async function markTurnGenerating(input: MarkTurnGeneratingInput): Promise<void> {
  await input.db
    .update(chatTurns)
    .set({
      status: "generating",
      providerKind: providerKindForDb(input.runtimeConfig.providerKind),
      model: input.runtimeConfig.model,
      updatedAt: new Date(),
    })
    .where(eq(chatTurns.id, input.turnId));
  await input.db
    .update(chatMessages)
    .set({
      status: "streaming",
      providerKind: providerKindForDb(input.runtimeConfig.providerKind),
      model: input.runtimeConfig.model,
    })
    .where(eq(chatMessages.id, input.assistantMessageId));
}

export async function updateAssistantPartial(
  db: ApiDb,
  assistantMessageId: string,
  content: string,
): Promise<void> {
  await db
    .update(chatMessages)
    .set({ content })
    .where(eq(chatMessages.id, assistantMessageId));
}

/** Finalize a streaming turn: write assistant content, citations, and turn status. */
export async function completeStreamingTurn(
  input: CompleteStreamingTurnInput,
): Promise<ChatMessageRow> {
  const surface = input.surface ?? "web_chat";
  const [assistantMessage] = await input.db
    .update(chatMessages)
    .set({
      content: input.finalContent,
      status: "completed",
      providerKind: providerKindForDb(input.runtimeConfig.providerKind),
      model: input.model,
      memoryFragmentIds: memoryFragmentIdsFromMemoryContext(input.memoryContext, input.documentContext),
      citations: input.citations,
      usage: input.usage,
      metadata: {
        surface,
        providerSource: input.runtimeConfig.source,
        tokenContextSaved: input.tokenSavings.estimatedTokensSaved,
        tokenSavings: input.tokenSavings,
        retrievedMemoryCount: input.memoryContext.results.length,
        documentPassageCount: input.documentContext.passages.length,
        documentRetrievalPlan: input.documentContext.retrievalPlan,
        contextResolution: input.contextResolution,
        ...(input.retrievalStatus ? { retrievalStatus: input.retrievalStatus } : {}),
        timings: input.timings,
        contextPacket: {
          policy: input.documentContext.passages.length
            ? "bounded_retrieved_memory_with_document_passages"
            : "bounded_retrieved_memory",
          rawArtifactsIncluded: false,
          resolvedQuery: input.contextResolution.standaloneQuery,
        },
      },
    })
    .where(eq(chatMessages.id, input.assistantMessageId))
    .returning();
  await input.db
    .update(chatTurns)
    .set({
      status: "completed",
      providerKind: providerKindForDb(input.runtimeConfig.providerKind),
      model: input.model,
      completedAt: new Date(),
      metadata: {
        surface,
        contextResolution: input.contextResolution,
        ...(input.retrievalStatus ? { retrievalStatus: input.retrievalStatus } : {}),
        timings: input.timings,
      },
      updatedAt: new Date(),
    })
    .where(eq(chatTurns.id, input.turnId));
  return assistantMessage;
}

export async function recordCompletedStreamingTurnAudit(
  input: RecordCompletedStreamingTurnAuditInput,
): Promise<void> {
  try {
    const titleStartedAt = Date.now();
    const title = await generateSemanticChatTitle({
      userMessage: input.content,
      assistantMessage: input.finalContent,
      memoryContext: input.memoryContext,
      runtimeConfig: input.runtimeConfig,
      llmFetch: input.llmFetch,
    });
    const timings = {
      ...input.timings,
      titleGenerationMs: Date.now() - titleStartedAt,
    };
    await recordChatTurnAudit({
      c: input.c,
      db: input.db,
      gate: input.gate,
      llmFetch: input.llmFetch,
      content: input.content,
      runtimeConfig: input.runtimeConfig,
      turn: {
        output: {
          content: input.finalContent,
          provider: input.runtimeConfig.providerKind,
          model: input.model,
          metadata: { usage: input.usage },
        },
        memoryContext: input.memoryContext,
        documentContext: input.documentContext,
        contextResolution: input.contextResolution,
        citations: input.citations,
        usage: input.usage,
        tokenSavings: input.tokenSavings,
        title,
        timings,
        retrievalStatus: input.retrievalStatus,
      },
    });
  } catch (error) {
    console.warn("chat streaming finalization failed", {
      threadId: input.gate.thread.id,
      error: errorMessage(error),
    });
  }
}

export async function markTurnCancelled(
  db: ApiDb,
  turnId: string,
  assistantMessageId: string,
): Promise<void> {
  await db
    .update(chatTurns)
    .set({ status: "cancelled", cancelledAt: new Date(), updatedAt: new Date() })
    .where(eq(chatTurns.id, turnId));
  await db
    .update(chatMessages)
    .set({ status: "cancelled" })
    .where(eq(chatMessages.id, assistantMessageId));
}

export async function markTurnFailed(
  db: ApiDb,
  turnId: string,
  assistantMessageId: string,
  message: string,
  surface: ChatSurface = "web_chat",
): Promise<void> {
  await db
    .update(chatTurns)
    .set({
      status: "failed",
      errorCode: readChatErrorCode(message),
      errorMessage: message,
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(chatTurns.id, turnId));
  await db
    .update(chatMessages)
    .set({
      status: "failed",
      metadata: { surface, errorMessage: message },
    })
    .where(eq(chatMessages.id, assistantMessageId));
}

export async function recordChatMemoryIntakeOutcome(
  input: RecordChatMemoryIntakeOutcomeInput,
): Promise<void> {
  const outcome = buildChatMemoryIntakeOutcome(input.memoryIntent, input.memoryIntake);
  const [message] = await input.db
    .select({ metadata: chatMessages.metadata })
    .from(chatMessages)
    .where(eq(chatMessages.id, input.userMessageId))
    .limit(1);
  await input.db
    .update(chatMessages)
    .set({
      metadata: {
        ...(readRecord(message?.metadata) ?? {}),
        memoryIntent: input.memoryIntent,
        memoryIntake: outcome,
      },
    })
    .where(eq(chatMessages.id, input.userMessageId));
  if (!input.turnId) {
    return;
  }
  const [turn] = await input.db
    .select({ metadata: chatTurns.metadata })
    .from(chatTurns)
    .where(eq(chatTurns.id, input.turnId))
    .limit(1);
  await input.db
    .update(chatTurns)
    .set({
      metadata: {
        ...(readRecord(turn?.metadata) ?? {}),
        memoryIntent: input.memoryIntent,
        memoryIntake: outcome,
      },
      updatedAt: new Date(),
    })
    .where(eq(chatTurns.id, input.turnId));
}

export function buildChatMemoryIntakeOutcome(
  memoryIntent: ChatMemoryIntent,
  memoryIntake: MemoryIntakeResult,
): Record<string, unknown> {
  const status = memoryIntent === "private" ? "skipped_private" : memoryIntake.status;
  return {
    status,
    source: memoryIntake.source,
    factCount: memoryIntake.facts.length,
    engineeringMemoryCount: memoryIntake.engineeringMemories.length,
    facts: memoryIntake.facts.map((fact) => ({
      kind: fact.kind,
      slot: fact.slot,
      qualifier: fact.qualifier,
      valueType: fact.valueType,
      confidence: fact.confidence,
    })),
    engineeringMemories: memoryIntake.engineeringMemories.map((memory) => ({
      type: memory.engineeringMemoryType,
      scope: memory.scope,
      subject: memory.subject,
      hasAgentContextLine: Boolean(memory.agentContextLine),
      hasCodeReference: Boolean(memory.codeReference),
      confidence: memory.confidence,
    })),
    ...(memoryIntake.errorMessage ? { errorMessage: memoryIntake.errorMessage } : {}),
    updatedAt: new Date().toISOString(),
  };
}

export async function recordChatTurnAudit(input: ChatPersistTurnInput): Promise<void> {
  const auth = input.c.get("auth");
  const { output, memoryContext, documentContext, tokenSavings } = input.turn;
  const titleUpdate = resolveThreadTitleUpdate({
    currentTitle: input.gate.thread.title,
    currentMetadata: input.gate.thread.metadata,
    generatedTitle: (input.turn.title ?? { status: "failed", errorMessage: "missing_title" }) as GeneratedChatTitle,
    runtimeConfig: input.runtimeConfig,
    fallbackTitle: titleFromMessage(input.content),
  });
  await input.db
    .update(chatThreads)
    .set({
      title: titleUpdate.title,
      metadata: titleUpdate.metadata,
      llmProviderConfigId: input.runtimeConfig.source === "user"
        ? input.runtimeConfig.id
        : input.gate.thread.llmProviderConfigId,
      updatedAt: new Date(),
    })
    .where(and(eq(chatThreads.id, input.gate.thread.id), eq(chatThreads.twinId, input.gate.twinId)));
  await input.db.insert(auditEvents).values({
    twinId: input.gate.twinId,
    actorType: auth.type,
    actorId: auth.sub,
    eventType: "chat.assistant_response_created",
    resourceType: "chat_thread",
    resourceId: input.gate.thread.id,
    metadata: {
      providerKind: providerKindForDb(input.runtimeConfig.providerKind),
      providerSource: input.runtimeConfig.source,
      model: output.model,
      retrievedMemoryCount: memoryContext.results.length,
      documentPassageCount: documentContext?.passages?.length ?? 0,
      memoryFragmentIds: memoryFragmentIdsFromMemoryContext(memoryContext, documentContext),
      contextResolution: input.turn.contextResolution,
      ...(input.turn.retrievalStatus ? { retrievalStatus: input.turn.retrievalStatus } : {}),
      tokenContextSaved: tokenSavings.estimatedTokensSaved,
      tokenSavings,
      title: titleUpdate.auditMetadata,
      timings: input.turn.timings,
    },
  });
}

export function buildPostMessageResponse(
  userMessage: ChatMessageRow,
  assistantMessage: ChatMessageRow,
  turn: ChatTurnAuditPayload,
) {
  return {
    userMessage: toMessageResponse(userMessage),
    assistantMessage: toMessageResponse(assistantMessage),
    context: {
      citations: turn.citations,
      memoryCount: turn.memoryContext.results.length,
      documentPassageCount: turn.documentContext?.passages?.length ?? 0,
      documentRetrievalPlan: turn.documentContext?.retrievalPlan,
      contextResolution: turn.contextResolution,
      ...(turn.retrievalStatus ? { retrievalStatus: turn.retrievalStatus } : {}),
      tokenContextSaved: (turn.tokenSavings as { estimatedTokensSaved?: number }).estimatedTokensSaved ?? 0,
      tokenSavings: turn.tokenSavings,
      policy: {
        rawArtifactsIncluded: false,
        memory: "Sivraj retrieved durable memory instead of replaying full history.",
      },
    },
  };
}
