import {
  DEFAULT_MANUAL_MEMORY_SENSITIVITY,
  ENCRYPTED_WALRUS_STORAGE_MODE,
} from "@sivraj/core";
import {
  auditEvents,
  connectorAccounts,
  connectorSources,
  sourceArtifacts,
  telegramIngestedMessages,
  telegramLinkTokens,
  twins,
} from "@sivraj/db";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import type { Context } from "hono";
import type { AppDependencies } from "../app.js";
import { shouldAttachTransientCiphertextBase64 } from "../lib/artifacts/helpers.js";
import { answerTelegramQuestion } from "../lib/telegram/ask.js";
import { createTelegramLinkToken, buildTelegramBotDeepLink, buildTelegramStartCommand, hashTelegramLinkToken, readTelegramBotUsername } from "../lib/telegram/link-token.js";
import {
  commitTelegramTextToHotMemory,
  resolveTelegramTextCaptureDisposition,
  telegramHotMemoryCommitMetadata,
  telegramTextCaptureReply,
} from "../lib/telegram/memory-capture.js";
import { TELEGRAM_REPLY } from "../lib/telegram/replies.js";
import {
  createInMemoryTelegramRateLimiter,
  readTelegramRateLimitConfig,
  telegramRateLimitKey,
} from "../lib/telegram/runtime-guards.js";
import { normalizeTelegramUpdate, readTelegramMessageKind } from "../lib/telegram/updates.js";
import {
  enqueueArtifactProcessingJob,
  insertQueuedSourceArtifact,
  sha256Hex,
  type StoredPrivateMemory,
} from "../lib/http/route-helpers.js";
import type { AuthorizedTwin } from "../lib/http/route-auth.js";
import { sanitizeSafeMetadata } from "../lib/safe-metadata.js";
import type { AuthEnv } from "../middleware/auth.js";
import type { TelegramInboundEvent, TelegramUserProfile } from "../types/telegram.types.js";

const TELEGRAM_WEBHOOK_SECRET_HEADER = "x-telegram-bot-api-secret-token";
const TELEGRAM_SOURCE_TYPE = "telegram_message" as const;
const TELEGRAM_PROVIDER = "telegram" as const;
const TELEGRAM_CAPTURE_SCOPES = ["telegram:messages:capture"];
const telegramWebhookRateLimiter = createInMemoryTelegramRateLimiter(
  readTelegramRateLimitConfig(process.env),
);

type TelegramConnectorAccount = typeof connectorAccounts.$inferSelect;
type TelegramConnectorSource = typeof connectorSources.$inferSelect;
type TelegramIngestedMessage = typeof telegramIngestedMessages.$inferSelect;
type TelegramLinkedAccountResolution =
  | { ok: true; account: TelegramConnectorAccount }
  | { ok: false; reason: "not_linked" | "ambiguous_linked_accounts"; accounts: TelegramConnectorAccount[] };

export function resolveTelegramLinkedAccount<T extends { id: string; twinId: string }>(
  accounts: T[],
):
  | { ok: true; account: T }
  | { ok: false; reason: "not_linked" | "ambiguous_linked_accounts"; accounts: T[] } {
  if (accounts.length === 0) {
    return { ok: false, reason: "not_linked", accounts: [] };
  }

  if (accounts.length === 1) {
    return { ok: true, account: accounts[0]! };
  }

  return { ok: false, reason: "ambiguous_linked_accounts", accounts };
}

export async function handleTelegramConnectionGet(
  c: Context<AuthEnv>,
  deps: AppDependencies,
  { twinId }: AuthorizedTwin,
) {
  const [accounts, pendingTokens, recentCaptures] = await Promise.all([
    deps.db
      .select()
      .from(connectorAccounts)
      .where(and(
        eq(connectorAccounts.twinId, twinId),
        eq(connectorAccounts.provider, TELEGRAM_PROVIDER),
      ))
      .orderBy(desc(connectorAccounts.createdAt))
      .limit(5),
    deps.db
      .select()
      .from(telegramLinkTokens)
      .where(and(
        eq(telegramLinkTokens.twinId, twinId),
        eq(telegramLinkTokens.status, "pending"),
      ))
      .orderBy(desc(telegramLinkTokens.createdAt))
      .limit(1),
    deps.db
      .select()
      .from(telegramIngestedMessages)
      .where(eq(telegramIngestedMessages.twinId, twinId))
      .orderBy(desc(telegramIngestedMessages.createdAt))
      .limit(10),
  ]);

  const activeAccount = accounts.find((account) => account.status === "connected") ?? null;
  const latestAccount = activeAccount ?? accounts[0] ?? null;
  const pendingToken = pendingTokens.find((token) => !isExpired(token.expiresAt)) ?? null;
  const status = resolveTelegramConnectionStatus({
    activeAccount,
    latestAccount,
    pendingToken: Boolean(pendingToken),
  });

  return c.json({
    status,
    botUsername: readTelegramBotUsername(),
    account: latestAccount ? formatTelegramAccount(latestAccount) : null,
    pendingLink: pendingToken ? {
      id: pendingToken.id,
      expiresAt: pendingToken.expiresAt.toISOString(),
    } : null,
    recentCaptures: recentCaptures.map(formatTelegramCapture),
  });
}

export async function handleTelegramLinkTokenCreate(
  c: Context<AuthEnv>,
  deps: AppDependencies,
  { auth, twinId }: AuthorizedTwin,
) {
  const now = new Date();
  const linkToken = createTelegramLinkToken(now);

  await deps.db
    .update(telegramLinkTokens)
    .set({
      status: "revoked",
      revokedAt: now,
      updatedAt: now,
    })
    .where(and(
      eq(telegramLinkTokens.twinId, twinId),
      eq(telegramLinkTokens.status, "pending"),
    ));

  const [row] = await deps.db
    .insert(telegramLinkTokens)
    .values({
      twinId,
      tokenHash: linkToken.tokenHash,
      status: "pending",
      expiresAt: linkToken.expiresAt,
      metadata: sanitizeSafeMetadata({
        createdBy: auth.sub,
        walletAddress: auth.walletAddress,
      }),
    })
    .returning();

  await deps.db.insert(auditEvents).values({
    twinId,
    actorType: auth.type,
    actorId: auth.sub,
    eventType: "telegram.link_token_created",
    resourceType: "telegram_link_token",
    resourceId: row.id,
    metadata: {
      expiresAt: linkToken.expiresAt.toISOString(),
      walletAddress: auth.walletAddress,
    },
  });

  return c.json({
    status: "pending_link",
    token: linkToken.token,
    tokenId: row.id,
    expiresAt: linkToken.expiresAt.toISOString(),
    botUsername: readTelegramBotUsername(),
    deepLink: buildTelegramBotDeepLink(linkToken.token),
    startCommand: buildTelegramStartCommand(linkToken.token),
  }, 201);
}

export async function handleTelegramRevoke(
  c: Context<AuthEnv>,
  deps: AppDependencies,
  { auth, twinId }: AuthorizedTwin,
) {
  const now = new Date();
  const existingAccounts = await deps.db
    .select()
    .from(connectorAccounts)
    .where(and(
      eq(connectorAccounts.twinId, twinId),
      eq(connectorAccounts.provider, TELEGRAM_PROVIDER),
    ));
  const connectedAccountIds = existingAccounts
    .filter((account) => account.status === "connected")
    .map((account) => account.id);
  const connectedSources = connectedAccountIds.length > 0
    ? await deps.db
      .select()
      .from(connectorSources)
      .where(and(
        eq(connectorSources.twinId, twinId),
        eq(connectorSources.provider, TELEGRAM_PROVIDER),
        eq(connectorSources.status, "connected"),
        inArray(connectorSources.connectorAccountId, connectedAccountIds),
      ))
    : [];
  const revokeChatIds = telegramRevokeChatIds(connectedSources);
  const accounts = await deps.db
    .update(connectorAccounts)
    .set({
      status: "disconnected",
      tokenRef: null,
      nextSyncAt: null,
      updatedAt: now,
    })
    .where(and(
      eq(connectorAccounts.twinId, twinId),
      eq(connectorAccounts.provider, TELEGRAM_PROVIDER),
    ))
    .returning();

  if (connectedAccountIds.length > 0) {
    await deps.db
      .update(connectorSources)
      .set({
        status: "disconnected",
        nextSyncAt: null,
        updatedAt: now,
      })
      .where(and(
        eq(connectorSources.twinId, twinId),
        eq(connectorSources.provider, TELEGRAM_PROVIDER),
        inArray(connectorSources.connectorAccountId, connectedAccountIds),
      ));
  }

  await deps.db
    .update(telegramLinkTokens)
    .set({
      status: "revoked",
      revokedAt: now,
      updatedAt: now,
    })
    .where(and(
      eq(telegramLinkTokens.twinId, twinId),
      eq(telegramLinkTokens.status, "pending"),
    ));

  await deps.db.insert(auditEvents).values({
    twinId,
    actorType: auth.type,
    actorId: auth.sub,
    eventType: "telegram.account_revoked",
    resourceType: "connector_account",
    resourceId: accounts[0]?.id ?? "telegram",
    metadata: {
      accountCount: accounts.length,
      notifiedChatCount: revokeChatIds.length,
      walletAddress: auth.walletAddress,
    },
  });

  await sendTelegramRevokeNotices(deps, revokeChatIds);

  return c.json({ status: accounts.length > 0 ? "revoked" : "unlinked" });
}

export async function handleTelegramWebhook(
  c: Context<AuthEnv>,
  deps: AppDependencies,
) {
  const receivedAtMs = Date.now();
  const expectedSecret = process.env["TELEGRAM_WEBHOOK_SECRET"]?.trim();

  if (!expectedSecret) {
    logTelegramWebhook("error", "telegram.webhook.misconfigured", {
      reason: "telegram_webhook_secret_not_configured",
    });
    return c.json({ error: "telegram_webhook_secret_not_configured" }, 503);
  }

  if (!isTelegramWebhookAuthorized(
    c.req.header(TELEGRAM_WEBHOOK_SECRET_HEADER),
    expectedSecret,
  )) {
    logTelegramWebhook("warn", "telegram.webhook.unauthorized", {});
    return c.json({ error: "invalid_telegram_webhook_secret" }, 401);
  }

  const body = await c.req.json().catch(() => null);

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    logTelegramWebhook("warn", "telegram.webhook.invalid", {
      reason: "invalid_json_body",
    });
    return c.json({ error: "invalid_json_body" }, 400);
  }

  const update = body as Record<string, unknown>;
  logTelegramWebhook("info", "telegram.webhook.received", telegramRawUpdateLogContext(update));

  const normalized = normalizeTelegramUpdate(update);

  if (!normalized.ok) {
    logTelegramWebhook("info", "telegram.webhook.skipped", {
      ...telegramRawUpdateLogContext(update),
      reason: normalized.reason,
    });
    return c.json({ ok: true, skipped: normalized.reason });
  }

  logTelegramWebhook("info", "telegram.webhook.routed", telegramEventLogContext(normalized.event));

  const rateLimit = telegramWebhookRateLimiter.check(telegramRateLimitKey(normalized.event));
  if (!rateLimit.allowed) {
    if (rateLimit.shouldNotify) {
      await sendTelegramReply(deps, normalized.event, TELEGRAM_REPLY.rateLimited);
    }

    logTelegramWebhook("warn", "telegram.webhook.rate_limited", {
      ...telegramEventLogContext(normalized.event),
      retryAfterSeconds: rateLimit.retryAfterSeconds,
      notified: rateLimit.shouldNotify,
    });

    return c.json({
      ok: true,
      action: "rate_limited",
      retryAfterSeconds: rateLimit.retryAfterSeconds,
    });
  }

  try {
    const result = await handleTelegramInboundEvent(deps, normalized.event);

    logTelegramWebhook("info", "telegram.webhook.completed", {
      ...telegramEventLogContext(normalized.event),
      ...telegramResultLogContext(result),
      durationMs: Date.now() - receivedAtMs,
    });

    return c.json({ ok: true, ...result });
  } catch (error) {
    logTelegramWebhook("error", "telegram.webhook.failed", {
      ...telegramEventLogContext(normalized.event),
      durationMs: Date.now() - receivedAtMs,
      error: errorMessage(error),
    });

    await sendTelegramReply(deps, normalized.event, TELEGRAM_REPLY.failed);
    return c.json({ error: "telegram_webhook_failed" }, 500);
  }
}

export function isTelegramWebhookAuthorized(
  headerValue: string | undefined,
  expectedSecret: string,
) {
  return Boolean(expectedSecret) && headerValue === expectedSecret;
}

export function telegramRevokeChatIds(
  sources: Array<{ externalSourceId: string }>,
) {
  return Array.from(
    new Set(
      sources
        .map((source) => source.externalSourceId.trim())
        .filter(Boolean),
    ),
  );
}

async function handleTelegramInboundEvent(
  deps: AppDependencies,
  event: TelegramInboundEvent,
) {
  if (event.kind === "link_command") {
    return handleTelegramLinkCommand(deps, event);
  }

  if (event.kind === "account_command") {
    return handleTelegramAccountCommand(deps, event);
  }

  if (event.kind === "capture_text") {
    return handleTelegramTextCapture(deps, event);
  }

  if (event.kind === "ask_command") {
    return handleTelegramAskCommand(deps, event);
  }

  if (event.kind === "capture_media") {
    return handleTelegramMediaCapture(deps, event);
  }

  await sendTelegramReply(deps, event, TELEGRAM_REPLY.unsupported);
  return { action: "unsupported" };
}

async function handleTelegramLinkCommand(
  deps: AppDependencies,
  event: Extract<TelegramInboundEvent, { kind: "link_command" }>,
) {
  const tokenHash = hashTelegramLinkToken(event.token);
  const [token] = await deps.db
    .select()
    .from(telegramLinkTokens)
    .where(eq(telegramLinkTokens.tokenHash, tokenHash))
    .limit(1);

  if (!token || token.status !== "pending") {
    await sendTelegramReply(deps, event, TELEGRAM_REPLY.expiredLink);
    return { action: "link_failed", reason: "link_token_not_pending" };
  }

  if (isExpired(token.expiresAt)) {
    await deps.db
      .update(telegramLinkTokens)
      .set({ status: "expired", updatedAt: new Date() })
      .where(eq(telegramLinkTokens.id, token.id));
    await sendTelegramReply(deps, event, TELEGRAM_REPLY.expiredLink);
    return { action: "link_failed", reason: "link_token_expired" };
  }

  const account = await upsertTelegramConnectorAccount(deps, {
    twinId: token.twinId,
    telegramUser: event.telegramUser,
  });
  await upsertTelegramConnectorSource(deps, {
    twinId: token.twinId,
    accountId: account.id,
    telegramUser: event.telegramUser,
    chatId: event.chatId,
  });
  const disconnectedPreviousAccounts = await disconnectOtherTelegramAccountsForUser(deps, {
    telegramUserId: event.telegramUser.id,
    keepAccountId: account.id,
  });

  const now = new Date();
  await deps.db
    .update(telegramLinkTokens)
    .set({
      status: "consumed",
      connectorAccountId: account.id,
      telegramUserId: event.telegramUser.id,
      chatId: event.chatId,
      consumedAt: now,
      updatedAt: now,
      metadata: sanitizeSafeMetadata({
        telegram: telegramUserMetadata(event.telegramUser),
      }),
    })
    .where(eq(telegramLinkTokens.id, token.id));

  await deps.db.insert(auditEvents).values({
    twinId: token.twinId,
    actorType: "system",
    actorId: "telegram-webhook",
    eventType: "telegram.account_linked",
    resourceType: "connector_account",
    resourceId: account.id,
    metadata: {
      telegramUserId: event.telegramUser.id,
      chatId: event.chatId,
      username: event.telegramUser.username,
      linkTokenId: token.id,
      disconnectedPreviousAccountCount: disconnectedPreviousAccounts.length,
    },
  });

  await sendTelegramReply(deps, event, TELEGRAM_REPLY.linked);
  return { action: "linked", twinId: token.twinId, accountId: account.id };
}

async function handleTelegramAccountCommand(
  deps: AppDependencies,
  event: Extract<TelegramInboundEvent, { kind: "account_command" }>,
) {
  if (event.command === "help") {
    await sendTelegramReply(deps, event, TELEGRAM_REPLY.help);
    return { action: "account_help" };
  }

  if (event.command === "switch") {
    await sendTelegramReply(deps, event, TELEGRAM_REPLY.switchAccount);
    return { action: "account_switch_guidance" };
  }

  const linked = await loadLinkedTelegramAccount(deps, event.telegramUser.id);

  if (!linked.ok) {
    return handleUnresolvedLinkedTelegramAccount(deps, event, linked);
  }

  const account = linked.account;

  if (event.command === "unlink") {
    return disconnectTelegramAccountFromBot(deps, event, account);
  }

  const twinName = await loadTelegramAccountTwinName(deps, account.twinId);
  await sendTelegramReply(
    deps,
    event,
    formatTelegramAccountStatusReply({
      twinName,
      accountDisplayName: account.displayName,
      linkedAt: readTelegramAccountLinkedAt(account),
    }),
  );

  return {
    action: "account_status",
    twinId: account.twinId,
    accountId: account.id,
  };
}

async function disconnectTelegramAccountFromBot(
  deps: AppDependencies,
  event: Extract<TelegramInboundEvent, { kind: "account_command" }>,
  account: TelegramConnectorAccount,
) {
  const now = new Date();

  await deps.db
    .update(connectorAccounts)
    .set({
      status: "disconnected",
      tokenRef: null,
      nextSyncAt: null,
      updatedAt: now,
    })
    .where(and(
      eq(connectorAccounts.id, account.id),
      eq(connectorAccounts.twinId, account.twinId),
      eq(connectorAccounts.provider, TELEGRAM_PROVIDER),
    ));

  await deps.db
    .update(connectorSources)
    .set({
      status: "disconnected",
      nextSyncAt: null,
      updatedAt: now,
    })
    .where(and(
      eq(connectorSources.twinId, account.twinId),
      eq(connectorSources.connectorAccountId, account.id),
      eq(connectorSources.provider, TELEGRAM_PROVIDER),
    ));

  await deps.db.insert(auditEvents).values({
    twinId: account.twinId,
    actorType: "system",
    actorId: "telegram-webhook",
    eventType: "telegram.account_unlinked_from_bot",
    resourceType: "connector_account",
    resourceId: account.id,
    metadata: {
      telegramUserId: event.telegramUser.id,
      chatId: event.chatId,
      messageId: event.messageId,
    },
  });

  await sendTelegramReply(deps, event, TELEGRAM_REPLY.revoked);
  return {
    action: "account_unlinked",
    twinId: account.twinId,
    accountId: account.id,
  };
}

async function loadTelegramAccountTwinName(
  deps: AppDependencies,
  twinId: string,
) {
  const [twin] = await deps.db
    .select({ name: twins.name })
    .from(twins)
    .where(eq(twins.id, twinId))
    .limit(1);

  return twin?.name ?? null;
}

async function handleTelegramTextCapture(
  deps: AppDependencies,
  event: Extract<TelegramInboundEvent, { kind: "capture_text" }>,
) {
  const linked = await loadLinkedTelegramAccount(deps, event.telegramUser.id);

  if (!linked.ok) {
    return handleUnresolvedLinkedTelegramAccount(deps, event, linked);
  }

  const account = linked.account;

  const disposition = resolveTelegramTextCaptureDisposition(event.text);
  if (disposition.action === "ignore") {
    await deps.db.insert(auditEvents).values({
      twinId: account.twinId,
      actorType: "system",
      actorId: "telegram-webhook",
      eventType: "telegram.message_ignored",
      resourceType: "telegram_message",
      resourceId: event.messageId,
      metadata: {
        telegramUserId: event.telegramUser.id,
        chatId: event.chatId,
        messageId: event.messageId,
        reason: disposition.reason,
      },
    });
    await sendTelegramReply(deps, event, disposition.replyText);
    return { action: "ignored", reason: disposition.reason };
  }

  const source = await upsertTelegramConnectorSource(deps, {
    twinId: account.twinId,
    accountId: account.id,
    telegramUser: event.telegramUser,
    chatId: event.chatId,
  });
  const claim = await claimTelegramMessage(deps, {
    twinId: account.twinId,
    accountId: account.id,
    sourceId: source.id,
    event,
    contentHash: sha256Hex(event.text),
  });

  if (!claim.ok) {
    await sendTelegramReply(deps, event, TELEGRAM_REPLY.duplicate);
    return { action: "duplicate", messageId: event.messageId };
  }

  if (!deps.privateMemoryStorage) {
    await markTelegramIngestedMessageFailed(deps, claim.row.id, "encrypted_storage_not_configured");
    await sendTelegramReply(deps, event, TELEGRAM_REPLY.failed);
    return { action: "failed", reason: "encrypted_storage_not_configured" };
  }

  const content = buildTelegramTextArtifactContent(event);
  const metadata = buildTelegramArtifactStorageMetadata(event, "text");
  const stored = await deps.privateMemoryStorage.storePrivateMemory({
    twinId: account.twinId,
    sourceType: TELEGRAM_SOURCE_TYPE,
    title: telegramArtifactTitle(event.telegramUser),
    content,
    metadata,
  }).catch(async (error: unknown) => {
    await markTelegramIngestedMessageFailed(deps, claim.row.id, "private_storage_failed", errorMessage(error));
    return null;
  });

  if (!stored) {
    await sendTelegramReply(deps, event, TELEGRAM_REPLY.failed);
    return { action: "failed", reason: "private_storage_failed" };
  }

  await cacheTelegramStoredCiphertext(deps, stored);

  const artifact = await insertQueuedSourceArtifact({
    db: deps.db,
    twinId: account.twinId,
    sourceType: TELEGRAM_SOURCE_TYPE,
    storageMetadata: metadata,
    stored,
    hash: sha256Hex(`telegram-message:v1:${event.chatId}:${event.messageId}:${sha256Hex(event.text)}`),
    uri: telegramMessageUri(event.chatId, event.messageId),
    connectorAccountId: account.id,
    connectorSourceId: source.id,
  }).catch(async (error: unknown) => {
    await markTelegramIngestedMessageFailed(
      deps,
      claim.row.id,
      "artifact_insert_failed",
      errorMessage(error),
    );
    return null;
  });

  if (!artifact) {
    await sendTelegramReply(deps, event, TELEGRAM_REPLY.failed);
    return { action: "failed", reason: "artifact_insert_failed" };
  }

  const transientCiphertext = buildTelegramTransientCiphertext(stored);
  const [queueResult, hotMemoryCommit] = await Promise.all([
    enqueueArtifactProcessingJob({
      db: deps.db,
      artifactProcessingQueue: deps.artifactProcessingQueue,
      twinId: account.twinId,
      artifactId: artifact.id,
      sourceType: TELEGRAM_SOURCE_TYPE,
      ...(transientCiphertext ? { transientCiphertext } : {}),
    }),
    commitTelegramTextToHotMemory({
      deps,
      twinId: account.twinId,
      sourceArtifactId: artifact.id,
      text: event.text,
    }),
  ]);
  const hotMemory = telegramHotMemoryCommitMetadata(hotMemoryCommit);
  const captureMetadata = sanitizeSafeMetadata({
    ...metadata,
    hotMemory,
  });

  await deps.db
    .update(telegramIngestedMessages)
    .set({
      status: "captured",
      sourceArtifactId: artifact.id,
      updatedAt: new Date(),
      metadata: captureMetadata,
    })
    .where(eq(telegramIngestedMessages.id, claim.row.id));

  await deps.db.insert(auditEvents).values({
    twinId: account.twinId,
    actorType: "system",
    actorId: "telegram-webhook",
    eventType: "telegram.message_captured",
    resourceType: "source_artifact",
    resourceId: artifact.id,
    metadata: {
      telegramUserId: event.telegramUser.id,
      chatId: event.chatId,
      messageId: event.messageId,
      queueWarning: queueResult.warning,
      hotMemory,
    },
  });

  await sendTelegramReply(deps, event, telegramTextCaptureReply(hotMemoryCommit));
  return {
    action: hotMemoryCommit.status === "committed" ? "remembered" : "captured",
    twinId: account.twinId,
    artifactId: artifact.id,
    processingJobId: queueResult.processingJobId,
    warning: queueResult.warning,
    hotMemory,
  };
}

async function handleTelegramAskCommand(
  deps: AppDependencies,
  event: Extract<TelegramInboundEvent, { kind: "ask_command" }>,
) {
  if (!event.question) {
    await sendTelegramReply(deps, event, TELEGRAM_REPLY.askUsage);
    return { action: "ask_usage" };
  }

  const linked = await loadLinkedTelegramAccount(deps, event.telegramUser.id);

  if (!linked.ok) {
    return handleUnresolvedLinkedTelegramAccount(deps, event, linked);
  }

  const account = linked.account;

  const source = await upsertTelegramConnectorSource(deps, {
    twinId: account.twinId,
    accountId: account.id,
    telegramUser: event.telegramUser,
    chatId: event.chatId,
  });

  await sendTelegramReply(deps, event, TELEGRAM_REPLY.askThinking);

  const answer = await answerTelegramQuestion({
    deps,
    twinId: account.twinId,
    connectorAccountId: account.id,
    connectorSourceId: source.id,
    event: {
      ...event,
      question: event.question,
    },
  }).catch(async (error: unknown) => {
    await recordTelegramQuestionFailure(deps, {
      twinId: account.twinId,
      accountId: account.id,
      sourceId: source.id,
      event,
      reason: "telegram_question_answer_failed",
      detail: errorMessage(error),
    });
    return null;
  });

  if (!answer) {
    await sendTelegramReply(deps, event, TELEGRAM_REPLY.askFailed);
    return { action: "ask_failed", reason: "telegram_question_answer_failed" };
  }

  if (!answer.ok) {
    await recordTelegramQuestionFailure(deps, {
      twinId: account.twinId,
      accountId: account.id,
      sourceId: source.id,
      event,
      reason: answer.reason,
    });
    await sendTelegramReply(deps, event, TELEGRAM_REPLY.askProviderMissing);
    return { action: "ask_failed", reason: answer.reason };
  }

  await sendTelegramReply(deps, event, answer.answerText);
  return {
    action: "answered",
    twinId: answer.twinId,
    threadId: answer.threadId,
    assistantMessageId: answer.assistantMessageId,
    retrievedMemoryCount: answer.retrievedMemoryCount,
    sourceCount: answer.sourceCount,
  };
}

async function handleTelegramMediaCapture(
  deps: AppDependencies,
  event: Extract<TelegramInboundEvent, { kind: "capture_media" }>,
) {
  const linked = await loadLinkedTelegramAccount(deps, event.telegramUser.id);

  if (!linked.ok) {
    return handleUnresolvedLinkedTelegramAccount(deps, event, linked);
  }

  const account = linked.account;

  const source = await upsertTelegramConnectorSource(deps, {
    twinId: account.twinId,
    accountId: account.id,
    telegramUser: event.telegramUser,
    chatId: event.chatId,
  });
  const claim = await claimTelegramMessage(deps, {
    twinId: account.twinId,
    accountId: account.id,
    sourceId: source.id,
    event,
    contentHash: event.fileId,
  });

  if (!claim.ok) {
    await sendTelegramReply(deps, event, TELEGRAM_REPLY.duplicate);
    return { action: "duplicate", messageId: event.messageId };
  }

  const metadata = buildTelegramCaptureMetadata(event, event.mediaKind);
  await deps.db
    .update(telegramIngestedMessages)
    .set({
      status: "deferred",
      updatedAt: new Date(),
      metadata,
    })
    .where(eq(telegramIngestedMessages.id, claim.row.id));

  await deps.db.insert(auditEvents).values({
    twinId: account.twinId,
    actorType: "system",
    actorId: "telegram-webhook",
    eventType: "telegram.message_deferred",
    resourceType: "telegram_message",
    resourceId: claim.row.id,
    metadata: {
      telegramUserId: event.telegramUser.id,
      chatId: event.chatId,
      messageId: event.messageId,
      mediaKind: event.mediaKind,
    },
  });

  await sendTelegramReply(deps, event, TELEGRAM_REPLY.mediaDeferred);
  return { action: "deferred", messageId: event.messageId, mediaKind: event.mediaKind };
}

async function recordTelegramQuestionFailure(
  deps: AppDependencies,
  input: {
    twinId: string;
    accountId: string;
    sourceId: string;
    event: Extract<TelegramInboundEvent, { kind: "ask_command" }>;
    reason: string;
    detail?: string;
  },
) {
  await deps.db.insert(auditEvents).values({
    twinId: input.twinId,
    actorType: "system",
    actorId: "telegram-webhook",
    eventType: "telegram.question_failed",
    resourceType: "telegram_message",
    resourceId: input.event.messageId,
    metadata: {
      connectorAccountId: input.accountId,
      connectorSourceId: input.sourceId,
      telegramUserId: input.event.telegramUser.id,
      chatId: input.event.chatId,
      messageId: input.event.messageId,
      reason: input.reason,
      ...(input.detail ? { detail: input.detail } : {}),
    },
  });
}

async function upsertTelegramConnectorAccount(
  deps: AppDependencies,
  input: {
    twinId: string;
    telegramUser: TelegramUserProfile;
  },
): Promise<TelegramConnectorAccount> {
  const [existing] = await deps.db
    .select()
    .from(connectorAccounts)
    .where(and(
      eq(connectorAccounts.twinId, input.twinId),
      eq(connectorAccounts.provider, TELEGRAM_PROVIDER),
      eq(connectorAccounts.externalAccountId, input.telegramUser.id),
    ))
    .limit(1);
  const metadata = sanitizeSafeMetadata({
    telegram: telegramUserMetadata(input.telegramUser),
    linkedAt: new Date().toISOString(),
  });

  if (existing) {
    const [updated] = await deps.db
      .update(connectorAccounts)
      .set({
        status: "connected",
        displayName: telegramAccountDisplayName(input.telegramUser),
        scopes: TELEGRAM_CAPTURE_SCOPES,
        metadata,
        errorCode: null,
        updatedAt: new Date(),
      })
      .where(and(
        eq(connectorAccounts.id, existing.id),
        eq(connectorAccounts.twinId, input.twinId),
      ))
      .returning();

    return updated ?? existing;
  }

  const [account] = await deps.db
    .insert(connectorAccounts)
    .values({
      twinId: input.twinId,
      provider: TELEGRAM_PROVIDER,
      status: "connected",
      externalAccountId: input.telegramUser.id,
      displayName: telegramAccountDisplayName(input.telegramUser),
      scopes: TELEGRAM_CAPTURE_SCOPES,
      syncCadence: "manual",
      metadata,
    })
    .returning();

  return account;
}

async function upsertTelegramConnectorSource(
  deps: AppDependencies,
  input: {
    twinId: string;
    accountId: string;
    telegramUser: TelegramUserProfile;
    chatId: string;
  },
): Promise<TelegramConnectorSource> {
  const [existing] = await deps.db
    .select()
    .from(connectorSources)
    .where(and(
      eq(connectorSources.twinId, input.twinId),
      eq(connectorSources.connectorAccountId, input.accountId),
      eq(connectorSources.externalSourceId, input.chatId),
    ))
    .limit(1);
  const metadata = sanitizeSafeMetadata({
    telegram: {
      chatId: input.chatId,
      user: telegramUserMetadata(input.telegramUser),
    },
  });

  if (existing) {
    const [updated] = await deps.db
      .update(connectorSources)
      .set({
        status: "connected",
        displayName: telegramSourceDisplayName(input.telegramUser),
        metadata,
        errorCode: null,
        updatedAt: new Date(),
      })
      .where(and(
        eq(connectorSources.id, existing.id),
        eq(connectorSources.twinId, input.twinId),
      ))
      .returning();

    return updated ?? existing;
  }

  const [source] = await deps.db
    .insert(connectorSources)
    .values({
      twinId: input.twinId,
      connectorAccountId: input.accountId,
      provider: TELEGRAM_PROVIDER,
      sourceType: TELEGRAM_SOURCE_TYPE,
      externalSourceId: input.chatId,
      displayName: telegramSourceDisplayName(input.telegramUser),
      uri: `telegram://chat/${input.chatId}`,
      status: "connected",
      metadata,
    })
    .returning();

  return source;
}

async function loadLinkedTelegramAccount(
  deps: AppDependencies,
  telegramUserId: string,
): Promise<TelegramLinkedAccountResolution> {
  const accounts = await deps.db
    .select()
    .from(connectorAccounts)
    .where(and(
      eq(connectorAccounts.provider, TELEGRAM_PROVIDER),
      eq(connectorAccounts.externalAccountId, telegramUserId),
      eq(connectorAccounts.status, "connected"),
    ))
    .orderBy(desc(connectorAccounts.updatedAt))
    .limit(10);

  return resolveTelegramLinkedAccount(accounts);
}

async function disconnectOtherTelegramAccountsForUser(
  deps: AppDependencies,
  input: {
    telegramUserId: string;
    keepAccountId: string;
  },
) {
  const otherAccounts = await deps.db
    .select()
    .from(connectorAccounts)
    .where(and(
      eq(connectorAccounts.provider, TELEGRAM_PROVIDER),
      eq(connectorAccounts.externalAccountId, input.telegramUserId),
      eq(connectorAccounts.status, "connected"),
      ne(connectorAccounts.id, input.keepAccountId),
    ));

  if (otherAccounts.length === 0) {
    return [];
  }

  const now = new Date();
  const accountIds = otherAccounts.map((account) => account.id);

  await deps.db
    .update(connectorAccounts)
    .set({
      status: "disconnected",
      tokenRef: null,
      nextSyncAt: null,
      updatedAt: now,
    })
    .where(inArray(connectorAccounts.id, accountIds));

  await deps.db
    .update(connectorSources)
    .set({
      status: "disconnected",
      nextSyncAt: null,
      updatedAt: now,
    })
    .where(and(
      eq(connectorSources.provider, TELEGRAM_PROVIDER),
      inArray(connectorSources.connectorAccountId, accountIds),
    ));

  return otherAccounts;
}

async function handleUnresolvedLinkedTelegramAccount(
  deps: AppDependencies,
  event: Extract<TelegramInboundEvent, { kind: "capture_text" | "capture_media" | "ask_command" | "account_command" }>,
  resolution: Extract<TelegramLinkedAccountResolution, { ok: false }>,
) {
  if (resolution.reason === "not_linked") {
    await sendTelegramReply(
      deps,
      event,
      event.kind === "account_command"
        ? TELEGRAM_REPLY.accountNeedsLink
        : TELEGRAM_REPLY.needsLink,
    );
    return { action: "needs_link" as const };
  }

  await recordAmbiguousTelegramLinkedAccount(deps, event, resolution.accounts);
  await sendTelegramReply(deps, event, TELEGRAM_REPLY.ambiguousLink);
  return {
    action: "ambiguous_linked_account" as const,
    linkedAccountCount: resolution.accounts.length,
  };
}

async function recordAmbiguousTelegramLinkedAccount(
  deps: AppDependencies,
  event: Extract<TelegramInboundEvent, { kind: "capture_text" | "capture_media" | "ask_command" | "account_command" }>,
  accounts: TelegramConnectorAccount[],
) {
  const accountIds = accounts.map((account) => account.id);
  const twinIds = accounts.map((account) => account.twinId);

  await Promise.all(accounts.map((account) =>
    deps.db.insert(auditEvents).values({
      twinId: account.twinId,
      actorType: "system",
      actorId: "telegram-webhook",
      eventType: "telegram.account_ambiguous",
      resourceType: "connector_account",
      resourceId: account.id,
      metadata: {
        telegramUserId: event.telegramUser.id,
        chatId: event.chatId,
        messageId: event.messageId,
        accountIds,
        twinIds,
      },
    }),
  ));
}

async function claimTelegramMessage(
  deps: AppDependencies,
  input: {
    twinId: string;
    accountId: string;
    sourceId: string;
    event: Extract<TelegramInboundEvent, { kind: "capture_text" | "capture_media" }>;
    contentHash: string;
  },
): Promise<{ ok: true; row: TelegramIngestedMessage } | { ok: false; row: TelegramIngestedMessage }> {
  const existing = await loadTelegramIngestedMessage(deps, {
    accountId: input.accountId,
    chatId: input.event.chatId,
    messageId: input.event.messageId,
  });

  if (existing && existing.status !== "failed") {
    return { ok: false, row: existing };
  }

  if (existing) {
    const [updated] = await deps.db
      .update(telegramIngestedMessages)
      .set({
        status: "processing",
        contentHash: input.contentHash,
        updatedAt: new Date(),
      })
      .where(eq(telegramIngestedMessages.id, existing.id))
      .returning();

    return { ok: true, row: updated ?? existing };
  }

  const [row] = await deps.db
    .insert(telegramIngestedMessages)
    .values({
      twinId: input.twinId,
      connectorAccountId: input.accountId,
      connectorSourceId: input.sourceId,
      telegramUserId: input.event.telegramUser.id,
      chatId: input.event.chatId,
      messageId: input.event.messageId,
      updateId: input.event.updateId,
      status: "processing",
      contentHash: input.contentHash,
      metadata: buildTelegramCaptureMetadata(
        input.event,
        readTelegramMessageKind(input.event),
      ),
    })
    .returning()
    .catch(async () => {
      const duplicate = await loadTelegramIngestedMessage(deps, {
        accountId: input.accountId,
        chatId: input.event.chatId,
        messageId: input.event.messageId,
      });

      return duplicate ? [duplicate] : [];
    });

  if (!row) {
    throw new Error("telegram_message_claim_failed");
  }

  return row.status === "processing"
    ? { ok: true, row }
    : { ok: false, row };
}

async function loadTelegramIngestedMessage(
  deps: AppDependencies,
  input: {
    accountId: string;
    chatId: string;
    messageId: string;
  },
) {
  const [message] = await deps.db
    .select()
    .from(telegramIngestedMessages)
    .where(and(
      eq(telegramIngestedMessages.connectorAccountId, input.accountId),
      eq(telegramIngestedMessages.chatId, input.chatId),
      eq(telegramIngestedMessages.messageId, input.messageId),
    ))
    .limit(1);

  return message ?? null;
}

async function markTelegramIngestedMessageFailed(
  deps: AppDependencies,
  messageId: string,
  reason: string,
  detail?: string,
) {
  await deps.db
    .update(telegramIngestedMessages)
    .set({
      status: "failed",
      updatedAt: new Date(),
      metadata: sanitizeSafeMetadata({
        failure: {
          reason,
          detail,
        },
      }),
    })
    .where(eq(telegramIngestedMessages.id, messageId));
}

async function sendTelegramReply(
  deps: AppDependencies,
  event: TelegramInboundEvent,
  text: string,
) {
  if (!deps.telegramClient) {
    logTelegramWebhook("warn", "telegram.reply.skipped", {
      ...telegramEventLogContext(event),
      reason: "telegram_client_not_configured",
    });
    return;
  }

  await deps.telegramClient.sendMessage({
    chatId: event.chatId,
    text,
    replyToMessageId: event.messageId,
  }).then(() => {
    logTelegramWebhook("info", "telegram.reply.sent", telegramEventLogContext(event));
  }).catch((error: unknown) => {
    logTelegramWebhook("warn", "telegram.reply.failed", {
      error: errorMessage(error),
      ...telegramEventLogContext(event),
    });
  });
}

async function sendTelegramRevokeNotices(
  deps: AppDependencies,
  chatIds: readonly string[],
) {
  const telegramClient = deps.telegramClient;
  if (!telegramClient || chatIds.length === 0) {
    return;
  }

  await Promise.all(chatIds.map((chatId) =>
    telegramClient.sendMessage({
      chatId,
      text: TELEGRAM_REPLY.revoked,
    }).catch((error: unknown) => {
      console.warn("telegram revoke notice failed", {
        error: errorMessage(error),
        chatId,
      });
    }),
  ));
}

function telegramRawUpdateLogContext(update: Record<string, unknown>) {
  const message = readRecord(update["message"]);
  const from = readRecord(message["from"]);
  const chat = readRecord(message["chat"]);

  return {
    updateId: valueToString(update["update_id"]),
    rawKind: summarizeRawTelegramUpdateKind(update),
    telegramUserHash: hashLogIdentifier(valueToString(from["id"])),
    chatHash: hashLogIdentifier(valueToString(chat["id"])),
    messageId: valueToString(message["message_id"]),
  };
}

function telegramEventLogContext(event: TelegramInboundEvent) {
  return {
    updateId: event.updateId,
    kind: event.kind,
    telegramUserHash: hashLogIdentifier(event.telegramUser.id),
    chatHash: hashLogIdentifier(event.chatId),
    messageId: event.messageId,
  };
}

function telegramResultLogContext(result: unknown) {
  const record = readRecord(result);

  return {
    action: valueToString(record["action"]),
    reason: valueToString(record["reason"]),
    twinId: valueToString(record["twinId"]),
    accountId: valueToString(record["accountId"]),
    artifactId: valueToString(record["artifactId"]),
    threadId: valueToString(record["threadId"]),
    sourceCount: valueToNumber(record["sourceCount"]),
  };
}

function logTelegramWebhook(
  level: "info" | "warn" | "error",
  message: string,
  metadata: Record<string, unknown>,
) {
  const log = level === "error"
    ? console.error
    : level === "warn"
      ? console.warn
      : console.log;

  log(message, compactLogMetadata({
    service: "sivraj-api",
    integration: "telegram",
    ...metadata,
  }));
}

function compactLogMetadata(metadata: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(metadata).filter(([, value]) =>
      value !== undefined &&
      value !== null &&
      value !== ""
    ),
  );
}

function summarizeRawTelegramUpdateKind(update: Record<string, unknown>) {
  const message = readRecord(update["message"]);

  if (Object.keys(message).length === 0) {
    return "non_message";
  }
  if (message["text"]) {
    return "text";
  }
  if (message["voice"]) {
    return "voice";
  }
  if (message["photo"]) {
    return "photo";
  }
  if (message["document"]) {
    return "document";
  }
  if (message["audio"]) {
    return "audio";
  }
  if (message["video"]) {
    return "video";
  }

  return "message";
}

function hashLogIdentifier(value: string | null) {
  return value ? sha256Hex(`telegram-log:v1:${value}`).slice(0, 16) : null;
}

function valueToString(value: unknown) {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function valueToNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function resolveTelegramConnectionStatus(input: {
  activeAccount: TelegramConnectorAccount | null;
  latestAccount: TelegramConnectorAccount | null;
  pendingToken: boolean;
}) {
  if (input.activeAccount) {
    return "linked";
  }

  if (input.latestAccount?.status === "error") {
    return "error";
  }

  if (input.latestAccount?.status === "disconnected") {
    return "revoked";
  }

  if (input.pendingToken) {
    return "pending_link";
  }

  return "unlinked";
}

function formatTelegramAccount(account: TelegramConnectorAccount) {
  return {
    id: account.id,
    status: account.status,
    displayName: account.displayName,
    externalAccountId: account.externalAccountId,
    metadata: account.metadata,
    createdAt: account.createdAt.toISOString(),
    updatedAt: account.updatedAt.toISOString(),
  };
}

export function formatTelegramAccountStatusReply(input: {
  twinName?: string | null;
  accountDisplayName: string;
  linkedAt: Date;
}) {
  const twinName = input.twinName?.trim() || "your Sivraj Twin";

  return [
    `Linked to ${twinName}.`,
    `Telegram: ${input.accountDisplayName}`,
    `Linked: ${formatTelegramAccountStatusDate(input.linkedAt)}`,
    "Use /unlink to disconnect, or /switch to move this Telegram account to another Sivraj account.",
  ].join("\n");
}

function formatTelegramAccountStatusDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function readTelegramAccountLinkedAt(account: TelegramConnectorAccount) {
  const metadata = readRecord(account.metadata);
  const linkedAt = typeof metadata["linkedAt"] === "string"
    ? new Date(metadata["linkedAt"])
    : null;

  return linkedAt && Number.isFinite(linkedAt.getTime())
    ? linkedAt
    : account.updatedAt;
}

function formatTelegramCapture(capture: TelegramIngestedMessage) {
  return {
    id: capture.id,
    status: capture.status,
    sourceArtifactId: capture.sourceArtifactId,
    chatId: capture.chatId,
    messageId: capture.messageId,
    createdAt: capture.createdAt.toISOString(),
    metadata: capture.metadata,
  };
}

function buildTelegramTextArtifactContent(
  event: Extract<TelegramInboundEvent, { kind: "capture_text" }>,
) {
  const username = event.telegramUser.username ? `@${event.telegramUser.username}` : "no username";

  return [
    "Telegram message",
    `From: ${event.telegramUser.displayName} (${username})`,
    `Telegram user id: ${event.telegramUser.id}`,
    `Chat id: ${event.chatId}`,
    `Message id: ${event.messageId}`,
    `Sent at: ${event.sentAt}`,
    "",
    event.text,
  ].join("\n");
}

function buildTelegramCaptureMetadata(
  event: Extract<TelegramInboundEvent, { kind: "capture_text" | "capture_media" }>,
  messageKind: string,
) {
  return sanitizeSafeMetadata({
    sourceDisplayName: telegramArtifactTitle(event.telegramUser),
    sourceKind: "telegram_message",
    telegram: {
      updateId: event.updateId,
      user: telegramUserMetadata(event.telegramUser),
      chatId: event.chatId,
      messageId: event.messageId,
      messageKind,
      sentAt: event.sentAt,
      uri: telegramMessageUri(event.chatId, event.messageId),
      ...(event.kind === "capture_media"
        ? {
            fileId: event.fileId,
            fileName: event.fileName,
            mimeType: event.mimeType,
            captionPresent: Boolean(event.caption),
          }
        : {}),
      ...(event.forwardOrigin ? { forwardOrigin: event.forwardOrigin } : {}),
    },
  });
}

export function buildTelegramArtifactStorageMetadata(
  event: Extract<TelegramInboundEvent, { kind: "capture_text" }>,
  messageKind: string,
) {
  return {
    ...buildTelegramCaptureMetadata(event, messageKind),
    storageMode: ENCRYPTED_WALRUS_STORAGE_MODE,
    sensitivity: DEFAULT_MANUAL_MEMORY_SENSITIVITY,
    encryptedPayload: {
      kind: "source_artifact",
      version: 1,
      encryptionBoundary: "api",
    },
  };
}

export function buildTelegramTransientCiphertext(stored: StoredPrivateMemory) {
  return stored.encryptedBytesBase64 && shouldAttachTransientCiphertextBase64(stored.encryptedBytesBase64)
    ? {
        base64: stored.encryptedBytesBase64,
        sha256: stored.ciphertextSha256,
      }
    : null;
}

async function cacheTelegramStoredCiphertext(
  deps: AppDependencies,
  stored: StoredPrivateMemory,
) {
  if (!deps.privateMemoryCiphertextCache || !stored.encryptedBytesBase64) {
    return;
  }

  await deps.privateMemoryCiphertextCache.putPrivateMemoryCiphertext({
    encryptedBytesBase64: stored.encryptedBytesBase64,
    rawStorageRef: stored.rawStorageRef,
    ciphertextSha256: stored.ciphertextSha256,
    byteLength: Buffer.from(stored.encryptedBytesBase64, "base64").byteLength,
    cachedAt: new Date().toISOString(),
    provider: "walrus",
    ttlSeconds: readTelegramFreshCaptureCacheTtlSeconds(process.env["TELEGRAM_FRESH_CAPTURE_CACHE_TTL_SECONDS"]),
  }).catch((error: unknown) => {
    console.warn("telegram ciphertext cache write failed", {
      rawStorageRef: stored.rawStorageRef,
      error: errorMessage(error),
    });
  });
}

function readTelegramFreshCaptureCacheTtlSeconds(value: string | undefined) {
  const parsed = value ? Number.parseInt(value, 10) : NaN;

  if (!Number.isFinite(parsed) || parsed < 60) {
    return 60 * 60;
  }

  return Math.min(parsed, 24 * 60 * 60);
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function telegramUserMetadata(user: TelegramUserProfile) {
  return {
    id: user.id,
    username: user.username,
    firstName: user.firstName,
    lastName: user.lastName,
    displayName: user.displayName,
  };
}

function telegramAccountDisplayName(user: TelegramUserProfile) {
  return user.username ? `Telegram @${user.username}` : `Telegram ${user.displayName}`;
}

function telegramSourceDisplayName(user: TelegramUserProfile) {
  return user.username ? `Private chat with @${user.username}` : `Private chat with ${user.displayName}`;
}

function telegramArtifactTitle(user: TelegramUserProfile) {
  return user.username ? `Telegram message from @${user.username}` : `Telegram message from ${user.displayName}`;
}

function telegramMessageUri(chatId: string, messageId: string) {
  return `telegram://chat/${encodeURIComponent(chatId)}/message/${encodeURIComponent(messageId)}`;
}

function isExpired(expiresAt: Date) {
  return expiresAt.getTime() <= Date.now();
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}
