import { loadMemorySearchConfig } from "@sivraj/config";
import { auditEvents, chatMessages, chatThreads, sourceArtifacts, telegramIngestedMessages } from "@sivraj/db";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import type { AppDependencies } from "../../app.js";
import type { ChatMemoryContext } from "../../types/chat.types.js";
import { loadCachedCoreCommsContext, loadCachedRuntimeProviderConfig } from "../chat/chat-cache.js";
import { loadTurnPlanningMemoryHints } from "../chat/current-truth.js";
import { loadThreadMessages, readPositiveInteger } from "../chat/helpers.js";
import { readPlannedMemoryRequest } from "../chat/memory-request.js";
import { readMemoryTokenAccounting } from "../chat/token-accounting.js";
import { generateChatTurn } from "../chat/turn-generation.js";
import { insertUserMessage, persistChatTurnForActor } from "../chat/turn-persistence.js";
import type { ConversationContextResolution } from "../chat/turn-types.js";
import { optionalString, readRecord } from "../http/route-helpers.js";
import type { TelegramInboundEvent, TelegramUserProfile } from "../../types/telegram.types.js";

const TELEGRAM_REPLY_CHAR_LIMIT = 3900;
const TELEGRAM_CHAT_SURFACE = "telegram" as const;
const TELEGRAM_FRESH_CAPTURE_WINDOW_DEFAULT_SECONDS = 60 * 60;
const TELEGRAM_FRESH_CAPTURE_LIMIT = 5;

type TelegramQuestionEvent = Extract<TelegramInboundEvent, { kind: "ask_command" }>;
type TelegramQuestionThread = typeof chatThreads.$inferSelect;

export type TelegramQuestionAnswerResult =
  | {
      ok: true;
      answerText: string;
      twinId: string;
      threadId: string;
      userMessageId: string | null;
      assistantMessageId: string;
      retrievedMemoryCount: number;
    }
  | {
      ok: false;
      reason: "llm_provider_not_configured";
    };

export async function answerTelegramQuestion(input: {
  deps: AppDependencies;
  twinId: string;
  connectorAccountId: string;
  connectorSourceId: string;
  event: TelegramQuestionEvent & { question: string };
}): Promise<TelegramQuestionAnswerResult> {
  const { deps, twinId, event } = input;
  const runtimeConfig = await loadCachedRuntimeProviderConfig(deps.db, twinId);

  if (!runtimeConfig) {
    return { ok: false, reason: "llm_provider_not_configured" };
  }

  const thread = await loadOrCreateTelegramQuestionThread({
    deps,
    twinId,
    connectorAccountId: input.connectorAccountId,
    connectorSourceId: input.connectorSourceId,
    event,
    llmProviderConfigId: runtimeConfig.source === "user" ? runtimeConfig.id : null,
  });
  const existingAnswer = await loadExistingTelegramAnswer({
    deps,
    twinId,
    threadId: thread.id,
    event,
  });

  if (existingAnswer) {
    return existingAnswer;
  }

  const messageMetadata = telegramQuestionMessageMetadata(input);
  const userMessage = await insertUserMessage(
    deps.db,
    twinId,
    thread.id,
    event.question,
    "private",
    TELEGRAM_CHAT_SURFACE,
    messageMetadata,
  );
  const contextResolution = buildTelegramAskContextResolution(event.question);
  const [coreCommsContext, planningMemoryHints, recentMessages, freshMemoryContext] = await Promise.all([
    loadCachedCoreCommsContext(deps.db, twinId),
    loadTurnPlanningMemoryHints(deps.db, twinId),
    loadThreadMessages(
      deps.db,
      twinId,
      thread.id,
      readPositiveInteger(process.env["CHAT_RECENT_RAW_MESSAGE_LIMIT"], 48),
    ),
    loadFreshTelegramCaptureMemoryContext({
      deps,
      twinId,
      connectorAccountId: input.connectorAccountId,
      connectorSourceId: input.connectorSourceId,
      query: event.question,
    }),
  ]);
  const turn = await generateChatTurn({
    db: deps.db,
    privateMemoryReader: deps.privateMemoryReader,
    llmFetch: deps.llmFetch,
    memorySearchConfig: deps.memorySearchConfig ?? loadMemorySearchConfig(process.env),
    twinId,
    threadId: thread.id,
    content: event.question,
    runtimeConfig,
    memoryIntent: "private",
    coreCommsContext,
    planningMemoryHints,
    recentMessages,
    contextResolution,
    freshMemoryContext,
    excludeMessageIds: new Set([userMessage.id]),
  });
  const assistantMessage = await persistChatTurnForActor({
    db: deps.db,
    gate: { twinId, thread },
    content: event.question,
    surface: TELEGRAM_CHAT_SURFACE,
    assistantMetadata: messageMetadata,
    runtimeConfig,
    turn,
    actor: {
      type: "system",
      sub: "telegram-webhook",
    },
  });

  await deps.db.insert(auditEvents).values({
    twinId,
    actorType: "system",
    actorId: "telegram-webhook",
    eventType: "telegram.question_answered",
    resourceType: "chat_thread",
    resourceId: thread.id,
    metadata: {
      connectorAccountId: input.connectorAccountId,
      connectorSourceId: input.connectorSourceId,
      telegramUserId: event.telegramUser.id,
      chatId: event.chatId,
      messageId: event.messageId,
      userMessageId: userMessage.id,
      assistantMessageId: assistantMessage.id,
      retrievedMemoryCount: turn.memoryContext.results.length,
      freshTelegramMemoryCount: freshMemoryContext.results.length,
      documentPassageCount: turn.documentContext.passages.length,
    },
  });

  return {
    ok: true,
    answerText: formatTelegramAnswerText(assistantMessage.content),
    twinId,
    threadId: thread.id,
    userMessageId: userMessage.id,
    assistantMessageId: assistantMessage.id,
    retrievedMemoryCount: turn.memoryContext.results.length,
  };
}

export function formatTelegramAnswerText(answer: string): string {
  const trimmed = answer.trim();

  if (!trimmed) {
    return "I do not have an answer yet.";
  }

  if (trimmed.length <= TELEGRAM_REPLY_CHAR_LIMIT) {
    return trimmed;
  }

  const suffix = "\n\n[truncated]";
  return `${trimmed.slice(0, TELEGRAM_REPLY_CHAR_LIMIT - suffix.length).trimEnd()}${suffix}`;
}

export function buildTelegramAskContextResolution(question: string): ConversationContextResolution {
  const baseResolution = {
    intent: "memory_qa" as const,
    answerTarget: "memory" as const,
    retrieval: "hot_memory" as const,
  };

  return {
    source: "fallback",
    standaloneQuery: question,
    intent: baseResolution.intent,
    turnKind: "question",
    answerTarget: baseResolution.answerTarget,
    memoryWrite: "skip",
    retrieval: baseResolution.retrieval,
    confidence: 1,
    referencedMessageIds: [],
    memoryRequest: readPlannedMemoryRequest(undefined, {
      query: question,
      contextResolution: baseResolution,
    }),
    reason: "telegram_ask_command",
  };
}

async function loadFreshTelegramCaptureMemoryContext(input: {
  deps: AppDependencies;
  twinId: string;
  connectorAccountId: string;
  connectorSourceId: string;
  query: string;
}): Promise<ChatMemoryContext> {
  if (!input.deps.privateMemoryReader) {
    return emptyFreshMemoryContext();
  }

  const windowSeconds = readFreshCaptureWindowSeconds(process.env["TELEGRAM_FRESH_CAPTURE_WINDOW_SECONDS"]);
  const since = new Date(Date.now() - windowSeconds * 1000);
  const rows = await input.deps.db
    .select({
      artifact: sourceArtifacts,
      message: telegramIngestedMessages,
    })
    .from(telegramIngestedMessages)
    .innerJoin(sourceArtifacts, eq(sourceArtifacts.id, telegramIngestedMessages.sourceArtifactId))
    .where(and(
      eq(telegramIngestedMessages.twinId, input.twinId),
      eq(telegramIngestedMessages.connectorAccountId, input.connectorAccountId),
      eq(telegramIngestedMessages.connectorSourceId, input.connectorSourceId),
      eq(telegramIngestedMessages.status, "captured"),
      eq(sourceArtifacts.twinId, input.twinId),
      eq(sourceArtifacts.sourceType, "telegram_message"),
      gte(telegramIngestedMessages.createdAt, since),
    ))
    .orderBy(desc(telegramIngestedMessages.createdAt))
    .limit(TELEGRAM_FRESH_CAPTURE_LIMIT);

  const results: ChatMemoryContext["results"] = [];
  const tokenAccountingByMemoryId = new Map<string, ReturnType<typeof readMemoryTokenAccounting>>();

  for (const row of rows) {
    if (!shouldUseFreshTelegramCapture(row.message)) {
      continue;
    }

    const content = await readFreshTelegramCaptureContent({
      deps: input.deps,
      twinId: input.twinId,
      artifact: row.artifact,
    });

    if (!content) {
      continue;
    }

    const memory = {
      id: `fresh-telegram:${row.artifact.id}`,
      twinId: input.twinId,
      sourceArtifactId: row.artifact.id,
      content,
      summary: content,
      importanceScore: 0.7,
      confidenceScore: 0.8,
      occurredAt: row.message.createdAt,
      createdAt: row.message.createdAt,
    };

    results.push({
      memory,
      score: scoreFreshTelegramCapture(content, input.query, row.message.createdAt),
      matchedTerms: ["fresh_telegram_capture"],
    });
    tokenAccountingByMemoryId.set(memory.id, readMemoryTokenAccounting(null, content));
  }

  return {
    results: results.sort((left, right) => right.score - left.score),
    tokenAccountingByMemoryId,
  };
}

export function shouldUseFreshTelegramCapture(message: Pick<typeof telegramIngestedMessages.$inferSelect, "metadata">): boolean {
  const metadata = readRecord(message.metadata);
  const hotMemory = readRecord(metadata["hotMemory"]);

  return hotMemory["retrievable"] !== false;
}

async function readFreshTelegramCaptureContent(input: {
  deps: AppDependencies;
  twinId: string;
  artifact: typeof sourceArtifacts.$inferSelect;
}): Promise<string | null> {
  if (!input.deps.privateMemoryReader || !input.artifact.rawStorageRef) {
    return null;
  }

  const metadata = readRecord(input.artifact.metadata);
  const payload = await input.deps.privateMemoryReader.readPrivateMemory({
    rawStorageRef: input.artifact.rawStorageRef,
    artifactId: input.artifact.id,
    twinId: input.twinId,
    expectedCiphertextSha256: optionalString(metadata["ciphertextSha256"]),
  }).then(readPrivateSourcePayload).catch((error: unknown) => {
    console.warn("telegram fresh capture decrypt failed", {
      artifactId: input.artifact.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  });

  return payload ? extractTelegramCapturedText(payload.content) : null;
}

function readPrivateSourcePayload(value: string): {
  content: string;
} | null {
  const parsed = JSON.parse(value) as unknown;
  const record = readRecord(parsed);

  if (
    record["kind"] !== "source_artifact" ||
    record["version"] !== 1 ||
    typeof record["content"] !== "string"
  ) {
    return null;
  }

  return { content: record["content"] };
}

export function extractTelegramCapturedText(content: string): string {
  const separatorIndex = content.indexOf("\n\n");
  const capturedText = separatorIndex >= 0
    ? content.slice(separatorIndex + 2)
    : content;

  return capturedText.trim().slice(0, 2_000);
}

function scoreFreshTelegramCapture(content: string, query: string, createdAt: Date): number {
  const normalizedContent = content.toLowerCase();
  const queryTerms = query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((term) => term.length > 2);
  const matchedTerms = new Set(queryTerms.filter((term) => normalizedContent.includes(term)));
  const ageMinutes = Math.max(0, (Date.now() - createdAt.getTime()) / 60_000);
  const recencyBoost = Math.max(0, 2 - ageMinutes / 30);

  return Number((10 + matchedTerms.size + recencyBoost).toFixed(4));
}

function emptyFreshMemoryContext(): ChatMemoryContext {
  return {
    results: [],
    tokenAccountingByMemoryId: new Map(),
  };
}

function readFreshCaptureWindowSeconds(value: string | undefined): number {
  const parsed = value ? Number.parseInt(value, 10) : NaN;

  if (!Number.isFinite(parsed) || parsed < 60) {
    return TELEGRAM_FRESH_CAPTURE_WINDOW_DEFAULT_SECONDS;
  }

  return Math.min(parsed, 24 * 60 * 60);
}

async function loadOrCreateTelegramQuestionThread(input: {
  deps: AppDependencies;
  twinId: string;
  connectorAccountId: string;
  connectorSourceId: string;
  event: TelegramQuestionEvent;
  llmProviderConfigId: string | null;
}): Promise<TelegramQuestionThread> {
  const [existing] = await input.deps.db
    .select()
    .from(chatThreads)
    .where(and(
      eq(chatThreads.twinId, input.twinId),
      sql`${chatThreads.metadata}->>'surface' = ${TELEGRAM_CHAT_SURFACE}`,
      sql`${chatThreads.metadata}->>'telegramChatId' = ${input.event.chatId}`,
      sql`${chatThreads.metadata}->>'connectorAccountId' = ${input.connectorAccountId}`,
    ))
    .orderBy(desc(chatThreads.updatedAt))
    .limit(1);

  if (existing) {
    return existing;
  }

  const [thread] = await input.deps.db
    .insert(chatThreads)
    .values({
      twinId: input.twinId,
      title: telegramThreadTitle(input.event.telegramUser),
      llmProviderConfigId: input.llmProviderConfigId,
      metadata: telegramQuestionThreadMetadata(input),
    })
    .returning();

  return thread;
}

async function loadExistingTelegramAnswer(input: {
  deps: AppDependencies;
  twinId: string;
  threadId: string;
  event: TelegramQuestionEvent;
}): Promise<Extract<TelegramQuestionAnswerResult, { ok: true }> | null> {
  const [assistantMessage] = await input.deps.db
    .select()
    .from(chatMessages)
    .where(and(
      eq(chatMessages.twinId, input.twinId),
      eq(chatMessages.threadId, input.threadId),
      eq(chatMessages.role, "assistant"),
      eq(chatMessages.status, "completed"),
      sql`${chatMessages.metadata}->>'sourceKind' = 'telegram_qa'`,
      sql`${chatMessages.metadata}->>'telegramMessageId' = ${input.event.messageId}`,
    ))
    .orderBy(desc(chatMessages.createdAt))
    .limit(1);

  if (!assistantMessage) {
    return null;
  }

  return {
    ok: true,
    answerText: formatTelegramAnswerText(assistantMessage.content),
    twinId: input.twinId,
    threadId: input.threadId,
    userMessageId: null,
    assistantMessageId: assistantMessage.id,
    retrievedMemoryCount: readRetrievedMemoryCount(assistantMessage.metadata),
  };
}

function telegramQuestionThreadMetadata(input: {
  connectorAccountId: string;
  connectorSourceId: string;
  event: TelegramQuestionEvent;
}) {
  return {
    surface: TELEGRAM_CHAT_SURFACE,
    sourceKind: "telegram_qa",
    connectorAccountId: input.connectorAccountId,
    connectorSourceId: input.connectorSourceId,
    telegramChatId: input.event.chatId,
    telegramUserId: input.event.telegramUser.id,
    telegramUsername: input.event.telegramUser.username,
  };
}

function telegramQuestionMessageMetadata(input: {
  connectorAccountId: string;
  connectorSourceId: string;
  event: TelegramQuestionEvent;
}) {
  return {
    sourceKind: "telegram_qa",
    connectorAccountId: input.connectorAccountId,
    connectorSourceId: input.connectorSourceId,
    telegramChatId: input.event.chatId,
    telegramMessageId: input.event.messageId,
    telegramUpdateId: input.event.updateId,
    telegramUserId: input.event.telegramUser.id,
    telegramUsername: input.event.telegramUser.username,
  };
}

function readRetrievedMemoryCount(metadata: unknown) {
  const count = readRecord(metadata)["retrievedMemoryCount"];
  return typeof count === "number" && Number.isFinite(count) ? count : 0;
}

function telegramThreadTitle(user: TelegramUserProfile) {
  return user.username ? `Telegram @${user.username}` : `Telegram ${user.displayName}`;
}
