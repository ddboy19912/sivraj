import { loadMemorySearchConfig } from "@sivraj/config";
import { auditEvents, chatMessages, chatThreads, sourceArtifacts, telegramIngestedMessages } from "@sivraj/db";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import type { AppDependencies } from "../../app.js";
import type { ChatMemoryContext } from "../../types/chat.types.js";
import { loadCachedCoreCommsContext, loadCachedRuntimeProviderConfig } from "../chat/chat-cache.js";
import { loadTurnPlanningMemoryHints } from "../chat/current-truth.js";
import { loadThreadMessages, readPositiveInteger } from "../chat/helpers.js";
import { readMemoryTokenAccounting } from "../chat/token-accounting.js";
import { generateChatTurn } from "../chat/turn-generation.js";
import { insertUserMessage, persistChatTurnForActor } from "../chat/turn-persistence.js";
import { optionalString, readRecord } from "../http/route-helpers.js";
import { resolveTelegramAskContextResolution } from "./ask-context.js";
import type { TelegramInboundEvent, TelegramUserProfile } from "../../types/telegram.types.js";

const TELEGRAM_REPLY_CHAR_LIMIT = 3900;
const TELEGRAM_CHAT_SURFACE = "telegram" as const;
const TELEGRAM_FRESH_CAPTURE_WINDOW_DEFAULT_SECONDS = 60 * 60;
const TELEGRAM_FRESH_CAPTURE_LIMIT = 5;
const TELEGRAM_ANSWER_SOURCE_LIMIT = 3;
const TELEGRAM_SOURCE_ARTIFACT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const TELEGRAM_NON_TERMINAL_ANSWER_FALLBACK =
  "I couldn’t complete that answer in this Telegram turn. Please ask again and I’ll answer directly, or tell you if the source is unreadable.";
const TELEGRAM_QUESTION_SOURCE_KIND = "telegram_qa";
const TELEGRAM_CAPSULE_SOURCE_KIND = "telegram_capsule";

type TelegramQuestionEvent = Extract<TelegramInboundEvent, { kind: "ask_command" | "capsule_command" }>;
type TelegramQuestionThread = typeof chatThreads.$inferSelect;
type TelegramQuestionSourceKind =
  | typeof TELEGRAM_QUESTION_SOURCE_KIND
  | typeof TELEGRAM_CAPSULE_SOURCE_KIND;

export type TelegramAnswerSource = {
  artifactId: string;
  displayName: string;
  sourceType: string;
  createdAt: Date;
  citationLabels: string[];
};

type TelegramAnswerCitation = {
  sourceArtifactId: string;
  label: string | null;
};

type TelegramAnswerSourceArtifact = {
  id: string;
  sourceType: string;
  metadata: unknown;
  createdAt: Date;
};

export type TelegramQuestionAnswerResult =
  | {
      ok: true;
      answerText: string;
      twinId: string;
      threadId: string;
      userMessageId: string | null;
      assistantMessageId: string;
      retrievedMemoryCount: number;
      sourceCount: number;
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
  event: TelegramQuestionEvent;
  question: string;
  sourceKind?: TelegramQuestionSourceKind;
  auditEventType?: "telegram.question_answered" | "telegram.capsule_answered";
  auditMetadata?: Record<string, unknown>;
}): Promise<TelegramQuestionAnswerResult> {
  const { deps, twinId, event, question } = input;
  const sourceKind = input.sourceKind ?? TELEGRAM_QUESTION_SOURCE_KIND;
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
    sourceKind,
  });

  if (existingAnswer) {
    return existingAnswer;
  }

  const messageMetadata = telegramQuestionMessageMetadata({
    connectorAccountId: input.connectorAccountId,
    connectorSourceId: input.connectorSourceId,
    event,
    sourceKind,
    auditMetadata: input.auditMetadata,
  });
  const userMessage = await insertUserMessage(
    deps.db,
    twinId,
    thread.id,
    question,
    "private",
    TELEGRAM_CHAT_SURFACE,
    messageMetadata,
  );
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
      query: question,
    }),
  ]);
  const excludeMessageIds = new Set([userMessage.id]);
  const contextResolution = await resolveTelegramAskContextResolution({
    currentMessage: question,
    recentMessages,
    excludeMessageIds,
    coreCommsContext,
    memoryHints: planningMemoryHints,
    runtimeConfig,
    llmFetch: deps.llmFetch,
  });
  const turn = enforceTerminalTelegramAnswerTurn(await generateChatTurn({
    db: deps.db,
    privateMemoryReader: deps.privateMemoryReader,
    llmFetch: deps.llmFetch,
    memorySearchConfig: deps.memorySearchConfig ?? loadMemorySearchConfig(process.env),
    twinId,
    threadId: thread.id,
    content: question,
    runtimeConfig,
    memoryIntent: "private",
    coreCommsContext,
    planningMemoryHints,
    recentMessages,
    contextResolution,
    freshMemoryContext,
    excludeMessageIds,
  }));
  const retrievalStatus = "retrievalStatus" in turn ? turn.retrievalStatus : undefined;
  const answerSources = await loadTelegramAnswerSources({
    deps,
    twinId,
    citations: turn.citations,
  });
  const assistantMessage = await persistChatTurnForActor({
    db: deps.db,
    gate: { twinId, thread },
    content: question,
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
    eventType: input.auditEventType ?? "telegram.question_answered",
    resourceType: "chat_thread",
    resourceId: thread.id,
    metadata: {
      connectorAccountId: input.connectorAccountId,
      connectorSourceId: input.connectorSourceId,
      sourceKind,
      telegramUserId: event.telegramUser.id,
      chatId: event.chatId,
      messageId: event.messageId,
      userMessageId: userMessage.id,
      assistantMessageId: assistantMessage.id,
      retrievedMemoryCount: turn.memoryContext.results.length,
      answerSourceCount: answerSources.length,
      freshTelegramMemoryCount: freshMemoryContext.results.length,
      documentPassageCount: turn.documentContext.passages.length,
      documentRetrievalPlan: turn.documentContext.retrievalPlan,
      contextResolution: turn.contextResolution,
      ...(input.auditMetadata ?? {}),
      ...(retrievalStatus ? { retrievalStatus } : {}),
    },
  });

  return {
    ok: true,
    answerText: formatTelegramAnswerText({
      answer: assistantMessage.content,
      sources: answerSources,
    }),
    twinId,
    threadId: thread.id,
    userMessageId: userMessage.id,
    assistantMessageId: assistantMessage.id,
    retrievedMemoryCount: turn.memoryContext.results.length,
    sourceCount: answerSources.length,
  };
}

export function formatTelegramAnswerText(input: {
  answer: string;
  sources?: TelegramAnswerSource[];
}): string {
  const trimmed = normalizeTerminalTelegramAnswerText(input.answer).trim() ||
    "I do not have an answer yet.";
  const footer = formatTelegramAnswerSourcesFooter(input.sources ?? []);

  if (!footer) {
    if (trimmed.length <= TELEGRAM_REPLY_CHAR_LIMIT) {
      return trimmed;
    }

    const suffix = "\n\n[truncated]";
    return `${trimmed.slice(0, TELEGRAM_REPLY_CHAR_LIMIT - suffix.length).trimEnd()}${suffix}`;
  }

  const footerBlock = `\n\n${footer}`;

  if (trimmed.length + footerBlock.length <= TELEGRAM_REPLY_CHAR_LIMIT) {
    return `${trimmed}${footerBlock}`;
  }

  const suffix = `\n\n[truncated]${footerBlock}`;
  const answerLimit = Math.max(0, TELEGRAM_REPLY_CHAR_LIMIT - suffix.length);

  return `${trimmed.slice(0, answerLimit).trimEnd()}${suffix}`;
}

export function buildTelegramCapsuleQuestion(topic: string): string {
  const normalizedTopic = topic.trim().replace(/\s+/gu, " ");

  return [
    `Create a compact, source-grounded context capsule for: ${normalizedTopic}.`,
    "Use only Sivraj memory and indexed documents. Do not invent missing details.",
    "Format the reply with these sections when evidence exists:",
    "Context Capsule",
    "Current state",
    "Key facts",
    "Decisions and commitments",
    "Open questions or risks",
    "Next useful context",
    "If there is not enough saved context, say that directly and name the most useful thing the user should drop into Sivraj.",
  ].join("\n");
}

type TelegramAnswerTurn = Awaited<ReturnType<typeof generateChatTurn>>;

export function enforceTerminalTelegramAnswerTurn(turn: TelegramAnswerTurn): TelegramAnswerTurn {
  const content = normalizeTerminalTelegramAnswerText(turn.output.content);

  if (content === turn.output.content) {
    return turn;
  }

  return {
    ...turn,
    output: {
      ...turn.output,
      content,
    },
  };
}

export function normalizeTerminalTelegramAnswerText(answer: string): string {
  return isNonTerminalTelegramAnswer(answer)
    ? TELEGRAM_NON_TERMINAL_ANSWER_FALLBACK
    : answer;
}

export function isNonTerminalTelegramAnswer(answer: string): boolean {
  const normalized = answer
    .toLowerCase()
    .replace(/\s+/gu, " ")
    .trim();

  if (!normalized || normalized.length > 360) {
    return false;
  }

  return /\bplease give me (?:a )?moment\b.*\b(?:process|access|retrieve|read|load|check|summari[sz]e)\b/u.test(normalized) ||
    /\b(?:i(?:'ll| will)|let me|i need to)\b.*\b(?:process|access|retrieve|read|load|check)\b.*\b(?:it|that|this|pdf|document|file|source)\b/u.test(normalized);
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
  sourceKind: TelegramQuestionSourceKind;
}): Promise<Extract<TelegramQuestionAnswerResult, { ok: true }> | null> {
  const [assistantMessage] = await input.deps.db
    .select()
    .from(chatMessages)
    .where(and(
      eq(chatMessages.twinId, input.twinId),
      eq(chatMessages.threadId, input.threadId),
      eq(chatMessages.role, "assistant"),
      eq(chatMessages.status, "completed"),
      sql`${chatMessages.metadata}->>'sourceKind' = ${input.sourceKind}`,
      sql`${chatMessages.metadata}->>'telegramMessageId' = ${input.event.messageId}`,
    ))
    .orderBy(desc(chatMessages.createdAt))
    .limit(1);

  if (!assistantMessage) {
    return null;
  }

  const answerSources = await loadTelegramAnswerSources({
    deps: input.deps,
    twinId: input.twinId,
    citations: assistantMessage.citations,
  });

  return {
    ok: true,
    answerText: formatTelegramAnswerText({
      answer: assistantMessage.content,
      sources: answerSources,
    }),
    twinId: input.twinId,
    threadId: input.threadId,
    userMessageId: null,
    assistantMessageId: assistantMessage.id,
    retrievedMemoryCount: readRetrievedMemoryCount(assistantMessage.metadata),
    sourceCount: answerSources.length,
  };
}

async function loadTelegramAnswerSources(input: {
  deps: AppDependencies;
  twinId: string;
  citations: unknown;
}): Promise<TelegramAnswerSource[]> {
  const citations = readTelegramAnswerCitations(input.citations);
  const artifactIds = uniqueStrings(citations.map((citation) => citation.sourceArtifactId))
    .filter((artifactId) => TELEGRAM_SOURCE_ARTIFACT_ID_PATTERN.test(artifactId));

  if (artifactIds.length === 0) {
    return [];
  }

  const artifacts = await input.deps.db
    .select({
      id: sourceArtifacts.id,
      sourceType: sourceArtifacts.sourceType,
      metadata: sourceArtifacts.metadata,
      createdAt: sourceArtifacts.createdAt,
    })
    .from(sourceArtifacts)
    .where(and(
      eq(sourceArtifacts.twinId, input.twinId),
      inArray(sourceArtifacts.id, artifactIds),
    ));

  return buildTelegramAnswerSources({ citations, artifacts });
}

export function buildTelegramAnswerSources(input: {
  citations: unknown;
  artifacts: TelegramAnswerSourceArtifact[];
}): TelegramAnswerSource[] {
  const citations = readTelegramAnswerCitations(input.citations);
  const artifactsById = new Map(input.artifacts.map((artifact) => [artifact.id, artifact]));
  const citedArtifacts = new Map<string, { firstIndex: number; citationLabels: string[] }>();

  citations.forEach((citation, index) => {
    const existing = citedArtifacts.get(citation.sourceArtifactId);

    if (existing) {
      if (citation.label && !existing.citationLabels.includes(citation.label)) {
        existing.citationLabels.push(citation.label);
      }
      return;
    }

    citedArtifacts.set(citation.sourceArtifactId, {
      firstIndex: index,
      citationLabels: citation.label ? [citation.label] : [],
    });
  });

  return Array.from(citedArtifacts.entries())
    .sort(([, left], [, right]) => left.firstIndex - right.firstIndex)
    .flatMap(([artifactId, citation]) => {
      const artifact = artifactsById.get(artifactId);

      if (!artifact) {
        return [];
      }

      return [{
        artifactId,
        displayName: readTelegramAnswerSourceDisplayName(artifact),
        sourceType: formatTelegramSourceType(artifact.sourceType),
        createdAt: artifact.createdAt,
        citationLabels: citation.citationLabels,
      }];
    })
    .slice(0, TELEGRAM_ANSWER_SOURCE_LIMIT);
}

function readTelegramAnswerCitations(value: unknown): TelegramAnswerCitation[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    const record = readRecord(item);
    const sourceArtifactId = optionalString(record["sourceArtifactId"]);

    if (!sourceArtifactId) {
      return [];
    }

    return [{
      sourceArtifactId,
      label: optionalString(record["label"]),
    }];
  });
}

function formatTelegramAnswerSourcesFooter(sources: TelegramAnswerSource[]): string {
  if (sources.length === 0) {
    return "";
  }

  return [
    "Sources:",
    ...sources
      .slice(0, TELEGRAM_ANSWER_SOURCE_LIMIT)
      .map((source, index) => `${index + 1}. ${formatTelegramAnswerSourceLine(source)}`),
  ].join("\n");
}

function formatTelegramAnswerSourceLine(source: TelegramAnswerSource): string {
  return [
    source.displayName,
    source.sourceType,
    formatTelegramSourceDate(source.createdAt),
  ].join(" · ");
}

function readTelegramAnswerSourceDisplayName(artifact: TelegramAnswerSourceArtifact): string {
  const metadata = readRecord(artifact.metadata);

  return optionalString(metadata["sourceDisplayName"]) ??
    optionalString(metadata["fileName"]) ??
    optionalString(metadata["title"]) ??
    formatTelegramSourceType(artifact.sourceType);
}

function formatTelegramSourceType(sourceType: string): string {
  const label = TELEGRAM_SOURCE_TYPE_LABELS[sourceType];

  if (label) {
    return label;
  }

  return sourceType
    .split("_")
    .filter((part) => part.length > 0)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ") || "Source";
}

function formatTelegramSourceDate(createdAt: Date): string {
  return createdAt.toISOString().slice(0, 10);
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

const TELEGRAM_SOURCE_TYPE_LABELS: Record<string, string> = {
  api: "API",
  browser_history: "Browser history",
  calendar: "Calendar",
  chat_export: "Chat export",
  csv: "CSV",
  docx: "DOCX",
  email: "Email",
  github: "GitHub",
  image: "Image",
  markdown: "Markdown",
  note: "Note",
  ocr_pdf: "OCR PDF",
  onboarding_self_description: "Onboarding",
  other: "Source",
  pdf: "PDF",
  slack_export: "Slack export",
  telegram_message: "Telegram message",
  upload: "Upload",
  url: "URL",
  voice_conversation: "Voice conversation",
  voice_note: "Voice note",
  whatsapp_export: "WhatsApp export",
};

function telegramQuestionThreadMetadata(input: {
  connectorAccountId: string;
  connectorSourceId: string;
  event: TelegramQuestionEvent;
}) {
  return {
    surface: TELEGRAM_CHAT_SURFACE,
    sourceKind: "telegram_chat",
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
  sourceKind: TelegramQuestionSourceKind;
  auditMetadata?: Record<string, unknown>;
}) {
  return {
    sourceKind: input.sourceKind,
    connectorAccountId: input.connectorAccountId,
    connectorSourceId: input.connectorSourceId,
    telegramChatId: input.event.chatId,
    telegramMessageId: input.event.messageId,
    telegramUpdateId: input.event.updateId,
    telegramUserId: input.event.telegramUser.id,
    telegramUsername: input.event.telegramUser.username,
    ...(input.auditMetadata ?? {}),
  };
}

function readRetrievedMemoryCount(metadata: unknown) {
  const count = readRecord(metadata)["retrievedMemoryCount"];
  return typeof count === "number" && Number.isFinite(count) ? count : 0;
}

function telegramThreadTitle(user: TelegramUserProfile) {
  return user.username ? `Telegram @${user.username}` : `Telegram ${user.displayName}`;
}
