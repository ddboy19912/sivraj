import { signSessionToken } from "@sivraj/auth";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { buildTelegramStartCommand, createTelegramLinkToken, hashTelegramLinkToken, readTelegramLinkTokenTtlSeconds } from "../lib/telegram/link-token.js";
import { createTelegramRoutes } from "./telegram.js";
import {
  buildTelegramArtifactStorageMetadata,
  buildTelegramTransientCiphertext,
  extractTelegramUrls,
  formatTelegramAccountStatusReply,
  isTelegramWebhookAuthorized,
  resolveTelegramLinkedAccount,
  resolveTelegramMediaSource,
  telegramResolvedMediaFileType,
  telegramRevokeChatIds,
} from "./telegram-handlers.js";
import type { TelegramInboundEvent } from "../types/telegram.types.js";

describe("Telegram webhook helpers", () => {
  it("verifies Telegram webhook secrets exactly", () => {
    expect(isTelegramWebhookAuthorized("secret", "secret")).toBe(true);
    expect(isTelegramWebhookAuthorized(" secret ", "secret")).toBe(false);
    expect(isTelegramWebhookAuthorized(undefined, "secret")).toBe(false);
    expect(isTelegramWebhookAuthorized("secret", "")).toBe(false);
  });

  it("hashes one-time link tokens before storage", () => {
    const token = createTelegramLinkToken(new Date("2026-06-27T10:00:00.000Z"));

    expect(token.token).toMatch(/^[A-Za-z0-9_-]+$/u);
    expect(token.tokenHash).toBe(hashTelegramLinkToken(token.token));
    expect(token.tokenHash).not.toContain(token.token);
    expect(token.expiresAt.toISOString()).toBe("2026-06-27T10:15:00.000Z");
  });

  it("formats fallback Telegram start commands without exposing hashing details", () => {
    expect(buildTelegramStartCommand("abc123")).toBe("/start abc123");
  });

  it("bounds Telegram link token ttl values", () => {
    expect(readTelegramLinkTokenTtlSeconds(undefined)).toBe(900);
    expect(readTelegramLinkTokenTtlSeconds("30")).toBe(900);
    expect(readTelegramLinkTokenTtlSeconds("120")).toBe(120);
    expect(readTelegramLinkTokenTtlSeconds("999999")).toBe(86_400);
  });

  it("dedupes Telegram chat ids before sending revoke notices", () => {
    expect(telegramRevokeChatIds([
      { externalSourceId: " 123 " },
      { externalSourceId: "123" },
      { externalSourceId: "" },
      { externalSourceId: "456" },
    ])).toEqual(["123", "456"]);
  });

  it("resolves exactly one active Telegram account", () => {
    const account = { id: "account-1", twinId: "twin-1" };

    expect(resolveTelegramLinkedAccount([account])).toEqual({
      ok: true,
      account,
    });
  });

  it("fails closed when a Telegram user maps to multiple active twins", () => {
    const accounts = [
      { id: "account-1", twinId: "twin-1" },
      { id: "account-2", twinId: "twin-2" },
    ];

    expect(resolveTelegramLinkedAccount(accounts)).toEqual({
      ok: false,
      reason: "ambiguous_linked_accounts",
      accounts,
    });
  });

  it("requires an explicit Telegram link before resolving an account", () => {
    expect(resolveTelegramLinkedAccount([])).toEqual({
      ok: false,
      reason: "not_linked",
      accounts: [],
    });
  });

  it("formats Telegram account status without exposing account ids", () => {
    expect(formatTelegramAccountStatusReply({
      twinName: "Fortune Twin",
      accountDisplayName: "Telegram @f_ogunsusi",
      linkedAt: new Date("2026-06-27T16:19:11.000Z"),
    })).toBe([
      "Linked to Fortune Twin.",
      "Telegram: Telegram @f_ogunsusi",
      "Linked: 2026-06-27",
      "Use /unlink to disconnect, or /switch to move this Telegram account to another Sivraj account.",
    ].join("\n"));
  });

  it("marks Telegram text captures as encrypted private source artifacts", () => {
    const metadata = buildTelegramArtifactStorageMetadata(telegramTextEvent(), "text");

    expect(metadata).toMatchObject({
      sourceKind: "telegram_message",
      sourceDisplayName: "Telegram message from @f_ogunsusi",
      telegramUpdateId: "update-1",
      telegramUserId: "user-1",
      telegramUsername: "f_ogunsusi",
      telegramChatId: "chat-1",
      telegramMessageId: "message-1",
      telegramMessageKind: "text",
      storageMode: "encrypted_walrus",
      sensitivity: "private",
      encryptedPayload: {
        kind: "source_artifact",
        version: 1,
        encryptionBoundary: "api",
      },
    });
    expect(metadata).not.toHaveProperty("telegram");
    expect(metadata).not.toHaveProperty("text");
  });

  it("preserves safe-rich forwarded provenance without raw text fields", () => {
    const metadata = buildTelegramArtifactStorageMetadata({
      ...telegramTextEvent(),
      forwardOrigin: {
        type: "user",
        senderUserId: "forward-user-1",
        senderUserName: "grace",
        senderUserFirstName: "Grace",
        date: "2026-06-27T15:00:00.000Z",
      },
    }, "text");

    expect(metadata).toMatchObject({
      forwardOriginType: "user",
      forwardSenderUserId: "forward-user-1",
      forwardSenderUserName: "grace",
      forwardSenderUserFirstName: "Grace",
      forwardOriginDate: "2026-06-27T15:00:00.000Z",
    });
    expect(metadata).not.toHaveProperty("message");
    expect(metadata).not.toHaveProperty("content");
  });

  it("extracts Telegram link drops with the first URL as primary", () => {
    expect(extractTelegramUrls(
      "Read https://example.com/a, then https://sivraj.ai/b.",
    ).map((url) => url.toString())).toEqual([
      "https://example.com/a",
      "https://sivraj.ai/b",
    ]);
  });

  it("resolves supported Telegram media source types", () => {
    expect(resolveTelegramMediaSource(telegramMediaEvent({
      mediaKind: "document",
      fileName: "Launch Notes.pdf",
      mimeType: "application/pdf",
    }))).toMatchObject({
      status: "supported",
      sourceType: "pdf",
      encoding: "base64",
      maxBytes: 20 * 1024 * 1024,
    });
    expect(resolveTelegramMediaSource(telegramMediaEvent({
      mediaKind: "document",
      fileName: "notes.md",
      mimeType: "text/markdown",
    }))).toMatchObject({
      status: "supported",
      sourceType: "markdown",
      encoding: "utf8",
    });
    expect(resolveTelegramMediaSource(telegramMediaEvent({
      mediaKind: "photo",
      fileName: null,
      mimeType: null,
    }))).toMatchObject({
      status: "supported",
      sourceType: "image",
    });
  });

  it("infers resolved media file type for Telegram photos without MIME metadata", () => {
    expect(telegramResolvedMediaFileType(telegramMediaEvent({
      mediaKind: "photo",
      fileName: null,
      mimeType: null,
    }), "photos/file_123.jpg")).toBe("image/jpeg");
    expect(telegramResolvedMediaFileType(telegramMediaEvent({
      mediaKind: "document",
      fileName: "notes.md",
      mimeType: "text/markdown",
    }), "documents/file")).toBe("text/markdown");
  });

  it("defers voice and unsupported Telegram media", () => {
    expect(resolveTelegramMediaSource(telegramMediaEvent({
      mediaKind: "voice",
      mimeType: "audio/ogg",
    }))).toMatchObject({
      status: "deferred",
      reason: "voice_not_supported",
    });
    expect(resolveTelegramMediaSource(telegramMediaEvent({
      mediaKind: "document",
      fileName: "archive.zip",
      mimeType: "application/zip",
    }))).toMatchObject({
      status: "deferred",
      reason: "unsupported_media_type",
    });
  });

  it("marks Telegram media metadata as safe flattened provenance", () => {
    const metadata = buildTelegramArtifactStorageMetadata(telegramMediaEvent({
      mediaKind: "document",
      fileName: "Launch Notes.pdf",
      mimeType: "application/pdf",
      caption: "raw private caption",
    }), "document", {
      sourceDisplayName: "Launch Notes.pdf",
      sourceKind: "telegram_file",
    });

    expect(metadata).toMatchObject({
      sourceKind: "telegram_file",
      sourceDisplayName: "Launch Notes.pdf",
      telegramFileName: "Launch Notes.pdf",
      telegramMimeType: "application/pdf",
      telegramCaptionPresent: true,
    });
    expect(metadata).not.toHaveProperty("caption");
  });

  it("attaches transient ciphertext for Telegram artifact processing", () => {
    expect(buildTelegramTransientCiphertext({
      rawStorageRef: "walrus://blob",
      ciphertextSha256: "sha256",
      seal: {},
      walrus: {},
      encryptedBytesBase64: Buffer.from("encrypted").toString("base64"),
    })).toEqual({
      base64: Buffer.from("encrypted").toString("base64"),
      sha256: "sha256",
    });
  });
});

describe("Telegram route authorization", () => {
  it("allows upload-scoped first-party users to read connection status", async () => {
    process.env["JWT_SECRET"] = "telegram-route-test-secret";
    process.env["TOKEN_ISSUER"] = "telegram-route-test";
    process.env["TELEGRAM_BOT_USERNAME"] = "sivraj_twin_bot";

    const app = new Hono();
    app.route("/v1/twins/:twinId/integrations/telegram", createTelegramRoutes({
      db: createEmptyTelegramStatusDb(),
    } as never));
    const token = await signSessionToken(
      {
        type: "user",
        sub: "user-1",
        twinId: "twin-1",
        walletAddress: "0xabc",
        scopes: ["artifact:upload"],
      },
      { jwtSecret: "telegram-route-test-secret", tokenIssuer: "telegram-route-test" },
    );

    const response = await app.request("/v1/twins/twin-1/integrations/telegram", {
      headers: { authorization: `Bearer ${token}` },
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "unlinked",
      botUsername: "sivraj_twin_bot",
      account: null,
      pendingLink: null,
      recentCaptures: [],
    });
  });
});

function createEmptyTelegramStatusDb() {
  const query = {
    where: () => query,
    orderBy: () => query,
    limit: async () => [],
  };

  return {
    select: () => ({
      from: () => query,
    }),
  };
}

function telegramMediaEvent(
  overrides: Partial<Extract<TelegramInboundEvent, { kind: "capture_media" }>> = {},
): Extract<TelegramInboundEvent, { kind: "capture_media" }> {
  return {
    kind: "capture_media",
    updateId: "update-2",
    telegramUser: {
      id: "user-1",
      username: "f_ogunsusi",
      firstName: "F",
      lastName: "Ogunsusi",
      displayName: "F Ogunsusi",
    },
    chatId: "chat-1",
    messageId: "message-2",
    mediaKind: "document",
    fileId: "file-1",
    fileUniqueId: "unique-1",
    fileSize: 1234,
    fileName: "Launch Notes.pdf",
    mimeType: "application/pdf",
    caption: null,
    sentAt: "2026-06-27T15:52:00.000Z",
    ...overrides,
  };
}

function telegramTextEvent(): Extract<TelegramInboundEvent, { kind: "capture_text" }> {
  return {
    kind: "capture_text",
    updateId: "update-1",
    telegramUser: {
      id: "user-1",
      username: "f_ogunsusi",
      firstName: "F",
      lastName: "Ogunsusi",
      displayName: "F Ogunsusi",
    },
    chatId: "chat-1",
    messageId: "message-1",
    text: "Remember that I prefer morning investor calls on Tuesdays.",
    sentAt: "2026-06-27T15:52:00.000Z",
  };
}
