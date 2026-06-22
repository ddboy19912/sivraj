/**
 * Thin Hono route handlers for chat threads and messages.
 *
 * HTTP-only layer: authorize, parse input, delegate to domain modules in `lib/chat/`,
 * map results to JSON or SSE. Turn logic lives in streaming-turn, turn-generation,
 * turn-persistence, and related modules — not here.
 */
import { chatMessages, chatThreads, sourceArtifacts } from "@sivraj/db";
import { and, desc, eq } from "drizzle-orm";
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import type { ApiDb } from "../app.js";
import type { AuthEnv } from "../middleware/auth.js";
import {
  emptyMemoryIntakeForIntent,
  type ChatMessageRow,
  type ChatRouteDependencies,
  type ChatTurnEventStream,
  type MemoryIntakeResult,
} from "../types/chat.types.js";
import { optionalString } from "../lib/http/route-helpers.js";
import {
  authorizeThread,
  loadThreadMessages,
  readPositiveInteger,
  recordValue,
  toMessageResponse,
  toThreadResponse,
} from "../lib/chat/helpers.js";
import { runChatMemoryIntake } from "../lib/chat/memory-intake.js";
import {
  NORMAL_CHAT_THREAD_FILTER,
  readChatSurface,
} from "../lib/chat/chat-surface.js";
import {
  readPostAttachmentInput,
  readPostMessageInput,
} from "../lib/chat/input.js";
import {
  buildChatAttachmentMetadata,
  hydrateChatMessageAttachmentMetadata,
  loadChatAttachmentArtifactStatuses,
} from "../lib/chat/attachments.js";
import { publicChatFailureMessage } from "../lib/chat/chat-errors.js";
import {
  buildPostMessageResponse,
  insertUserMessage,
  persistChatTurn,
  recordChatMemoryIntakeOutcome,
} from "../lib/chat/turn-persistence.js";
import { resolveConversationContext } from "../lib/chat/conversation-context.js";
import {
  loadTurnPlanningMemoryHints,
  resolveUserMemorySubject,
} from "../lib/chat/current-truth.js";
import {
  loadCachedCoreCommsContext,
  loadCachedRuntimeProviderConfig,
} from "../lib/chat/chat-cache.js";
import { enqueueCompletedChatTurnLearning } from "../lib/chat/chat-learning-queue.js";
import {
  buildStaticAssistantTurn,
  generateChatTurn,
} from "../lib/chat/turn-generation.js";
import { runStreamingChatTurn } from "../lib/chat/streaming-turn.js";
import {
  buildMemoryIntakeAcknowledgement,
  memoryIntakeFailureMessage,
  memoryIntakeIntentFromTurnPlan,
  memoryIntakeMessageFromTurnPlan,
  shouldFastAcknowledgeMemoryIntake,
  shouldFastAcknowledgePrivateDisclosure,
  shouldInterruptForMemoryIntakeFailure,
  shouldRunChatMemoryIntake,
  shouldUseLosslessMemoryFallback,
} from "../lib/chat/turn-policy.js";
import { generateSivrajVoiceReply } from "../lib/chat/voice-reply.js";
import { loadProviderConfig } from "./chat-provider-config.js";

export async function handleListThreads(
  c: Context<AuthEnv>,
  db: ApiDb,
  twinId: string,
) {
  const rows = await db
    .select()
    .from(chatThreads)
    .where(and(eq(chatThreads.twinId, twinId), NORMAL_CHAT_THREAD_FILTER))
    .orderBy(desc(chatThreads.updatedAt))
    .limit(50);
  return c.json({ threads: rows.map(toThreadResponse) });
}

export async function handleCreateThread(
  c: Context<AuthEnv>,
  db: ApiDb,
  twinId: string,
) {
  const body = await c.req.json().catch(() => ({}));
  const title = optionalString(recordValue(body, "title")) ?? "New chat";
  const surface = readChatSurface(recordValue(body, "surface"));
  const providerConfig = await loadProviderConfig(db, twinId);
  const [thread] = await db
    .insert(chatThreads)
    .values({
      twinId,
      title: title.slice(0, 120),
      llmProviderConfigId: providerConfig?.id ?? null,
      metadata: { surface },
    })
    .returning();
  return c.json({ thread: toThreadResponse(thread) }, 201);
}

export async function handleDeleteThread(c: Context<AuthEnv>, db: ApiDb) {
  const gate = await authorizeThread(c, db);
  if ("response" in gate) {
    return gate.response;
  }
  await db
    .delete(chatThreads)
    .where(
      and(
        eq(chatThreads.id, gate.thread.id),
        eq(chatThreads.twinId, gate.twinId),
      ),
    );
  const rows = await db
    .select()
    .from(chatThreads)
    .where(and(eq(chatThreads.twinId, gate.twinId), NORMAL_CHAT_THREAD_FILTER))
    .orderBy(desc(chatThreads.updatedAt))
    .limit(50);
  return c.json({ threads: rows.map(toThreadResponse) });
}

export async function handleGetThreadMessages(c: Context<AuthEnv>, db: ApiDb) {
  const gate = await authorizeThread(c, db);
  if ("response" in gate) {
    return gate.response;
  }
  const rows = await loadThreadMessages(db, gate.twinId, gate.thread.id, 200);
  const artifactStatuses = await loadChatAttachmentArtifactStatuses(
    db,
    gate.twinId,
    rows,
  );
  return c.json({
    thread: toThreadResponse(gate.thread),
    messages: rows.map((row: ChatMessageRow) =>
      toMessageResponse(
        hydrateChatMessageAttachmentMetadata(row, artifactStatuses),
      ),
    ),
  });
}

export async function handlePostThreadAttachment(
  c: Context<AuthEnv>,
  db: ApiDb,
) {
  const gate = await authorizeThread(c, db);
  if ("response" in gate) {
    return gate.response;
  }
  const input = await readPostAttachmentInput(c);
  if ("error" in input) {
    return c.json({ error: input.error }, input.status);
  }
  const [artifact] = await db
    .select()
    .from(sourceArtifacts)
    .where(
      and(
        eq(sourceArtifacts.id, input.artifactId),
        eq(sourceArtifacts.twinId, gate.twinId),
      ),
    )
    .limit(1);
  if (!artifact) {
    return c.json({ error: "attachment_artifact_not_found" }, 404);
  }
  const attachment = buildChatAttachmentMetadata({
    artifact,
    fileName: input.fileName,
    fileType: input.fileType,
    fileSize: input.fileSize,
  });
  const [message] = await db
    .insert(chatMessages)
    .values({
      twinId: gate.twinId,
      threadId: gate.thread.id,
      role: "user",
      status: "completed",
      content: "",
      memoryFragmentIds: [],
      metadata: {
        surface: "web_chat",
        messageKind: "attachment",
        attachments: [attachment],
      },
    })
    .returning();
  await db
    .update(chatThreads)
    .set({ updatedAt: new Date() })
    .where(
      and(
        eq(chatThreads.id, gate.thread.id),
        eq(chatThreads.twinId, gate.twinId),
      ),
    );
  return c.json(
    {
      message: toMessageResponse(message),
    },
    201,
  );
}

export async function handlePostThreadMessage(
  c: Context<AuthEnv>,
  deps: ChatRouteDependencies,
) {
  const gate = await authorizeThread(c, deps.db);
  if ("response" in gate) {
    return gate.response;
  }
  const input = await readPostMessageInput(c);
  if (!input.content) {
    return c.json({ error: "missing_chat_message" }, 400);
  }
  const { content, memoryIntent, surface } = input;
  const runtimeConfig = await loadCachedRuntimeProviderConfig(
    deps.db,
    gate.twinId,
  );
  if (!runtimeConfig) {
    return c.json({ error: "llm_provider_not_configured" }, 503);
  }
  const userMessage = await insertUserMessage(
    deps.db,
    gate.twinId,
    gate.thread.id,
    content,
    memoryIntent,
    surface,
  );
  const coreCommsContext = await loadCachedCoreCommsContext(
    deps.db,
    gate.twinId,
  );
  const planningMemoryHints = await loadTurnPlanningMemoryHints(
    deps.db,
    gate.twinId,
  );
  const recentMessages = await loadThreadMessages(
    deps.db,
    gate.twinId,
    gate.thread.id,
    readPositiveInteger(process.env["CHAT_RECENT_RAW_MESSAGE_LIMIT"], 48),
  );
  const contextResolution = await resolveConversationContext({
    currentMessage: content,
    recentMessages,
    excludeMessageIds: new Set([userMessage.id]),
    memoryIntent,
    coreCommsContext,
    memoryHints: planningMemoryHints,
    runtimeConfig,
    llmFetch: deps.llmFetch,
  });
  let memoryIntake: MemoryIntakeResult =
    emptyMemoryIntakeForIntent(memoryIntent);
  if (shouldRunChatMemoryIntake(contextResolution, memoryIntent)) {
    const memoryIntakeMessage = memoryIntakeMessageFromTurnPlan(
      content,
      contextResolution,
    );
    memoryIntake = await runChatMemoryIntake({
      db: deps.db,
      twinId: gate.twinId,
      userMessageId: userMessage.id,
      turnId: userMessage.turnId,
      subject: resolveUserMemorySubject(coreCommsContext),
      message: memoryIntakeMessage,
      intent: memoryIntakeIntentFromTurnPlan(contextResolution),
      losslessFallback: shouldUseLosslessMemoryFallback(
        contextResolution,
        memoryIntent,
      ),
      runtimeConfig,
      llmFetch: deps.llmFetch,
    });
  }
  await recordChatMemoryIntakeOutcome({
    db: deps.db,
    turnId: userMessage.turnId,
    userMessageId: userMessage.id,
    memoryIntent,
    memoryIntake,
  });
  if (
    shouldInterruptForMemoryIntakeFailure(
      contextResolution,
      memoryIntent,
      memoryIntake,
    )
  ) {
    return c.json(
      {
        error: "chat_memory_intake_failed",
        message: publicChatFailureMessage(
          memoryIntakeFailureMessage(memoryIntake),
        ),
      },
      503,
    );
  }
  if (shouldFastAcknowledgePrivateDisclosure(contextResolution, memoryIntent)) {
    const finalContent = await generateSivrajVoiceReply({
      kind: "private_ack",
      userMessage: content,
      runtimeConfig,
      llmFetch: deps.llmFetch,
      assistantName: coreCommsContext.assistantName,
    });
    const turn = buildStaticAssistantTurn({
      content: finalContent,
      runtimeConfig,
      contextResolution,
    });
    const assistantMessage = await persistChatTurn({
      c,
      db: deps.db,
      gate,
      llmFetch: deps.llmFetch,
      content,
      surface,
      runtimeConfig,
      turn,
    });
    return c.json(
      buildPostMessageResponse(userMessage, assistantMessage, turn),
      201,
    );
  }
  if (
    shouldFastAcknowledgeMemoryIntake(
      contextResolution,
      memoryIntake,
      memoryIntent,
    )
  ) {
    const turn = buildStaticAssistantTurn({
      content: buildMemoryIntakeAcknowledgement(memoryIntake),
      runtimeConfig,
      contextResolution,
    });
    const assistantMessage = await persistChatTurn({
      c,
      db: deps.db,
      gate,
      llmFetch: deps.llmFetch,
      content,
      surface,
      runtimeConfig,
      turn,
    });
    return c.json(
      buildPostMessageResponse(userMessage, assistantMessage, turn),
      201,
    );
  }
  const turn = await generateChatTurn({
    db: deps.db,
    privateMemoryReader: deps.privateMemoryReader,
    llmFetch: deps.llmFetch,
    memorySearchConfig: deps.memorySearchConfig,
    twinId: gate.twinId,
    threadId: gate.thread.id,
    content,
    runtimeConfig,
    memoryIntent,
    coreCommsContext,
    planningMemoryHints,
    recentMessages,
    contextResolution,
    excludeMessageIds: new Set([userMessage.id]),
  });
  const assistantMessage = await persistChatTurn({
    c,
    db: deps.db,
    gate,
    llmFetch: deps.llmFetch,
    content,
    surface,
    runtimeConfig,
    turn,
  });
  if (memoryIntent !== "private") {
    void enqueueCompletedChatTurnLearning({
      db: deps.db,
      privateMemoryStorage: deps.privateMemoryStorage,
      artifactProcessingQueue: deps.artifactProcessingQueue,
      gate,
      userMessage: content,
      assistantMessage: assistantMessage.content,
      userMessageId: userMessage.id,
      assistantMessageId: assistantMessage.id,
      turnId: assistantMessage.turnId,
      model: assistantMessage.model,
      providerKind: assistantMessage.providerKind,
      memoryIntent,
      contextResolution,
      retrievedMemoryCount: turn.memoryContext.results.length,
    });
  }
  return c.json(
    buildPostMessageResponse(userMessage, assistantMessage, turn),
    201,
  );
}

export async function handlePostThreadTurn(
  c: Context<AuthEnv>,
  deps: ChatRouteDependencies,
) {
  const gate = await authorizeThread(c, deps.db);
  if ("response" in gate) {
    return gate.response;
  }
  const input = await readPostMessageInput(c);
  if (!input.content) {
    return c.json({ error: "missing_chat_message" }, 400);
  }
  const { content, memoryIntent, surface, retryAttempt } = input;
  return streamSSE(c, async (stream: ChatTurnEventStream) => {
    const abortController = new AbortController();
    c.req.raw.signal.addEventListener("abort", () => abortController.abort(), {
      once: true,
    });
    await runStreamingChatTurn({
      c,
      deps,
      gate,
      stream,
      content,
      memoryIntent,
      surface,
      retryAttempt,
      abortController,
    });
  });
}
