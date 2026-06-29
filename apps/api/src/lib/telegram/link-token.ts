import { randomBytes } from "node:crypto";
import { sha256Hex } from "../http/route-helpers.js";

const DEFAULT_TELEGRAM_LINK_TOKEN_TTL_SECONDS = 15 * 60;

export type TelegramLinkToken = {
  token: string;
  tokenHash: string;
  expiresAt: Date;
};

export function createTelegramLinkToken(now = new Date()): TelegramLinkToken {
  const token = randomBytes(32).toString("base64url");
  const ttlSeconds = readTelegramLinkTokenTtlSeconds(
    process.env["TELEGRAM_LINK_TOKEN_TTL_SECONDS"],
  );

  return {
    token,
    tokenHash: hashTelegramLinkToken(token),
    expiresAt: new Date(now.getTime() + ttlSeconds * 1000),
  };
}

export function hashTelegramLinkToken(token: string): string {
  return sha256Hex(`telegram-link-token:v1:${token}`);
}

export function readTelegramLinkTokenTtlSeconds(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "", 10);

  if (!Number.isFinite(parsed) || parsed < 60) {
    return DEFAULT_TELEGRAM_LINK_TOKEN_TTL_SECONDS;
  }

  return Math.min(parsed, 24 * 60 * 60);
}

export function readTelegramBotUsername(env: NodeJS.ProcessEnv = process.env): string | null {
  const username = env["TELEGRAM_BOT_USERNAME"]?.trim().replace(/^@/u, "");
  return username && /^[A-Za-z0-9_]{5,32}$/u.test(username) ? username : null;
}

export function buildTelegramBotDeepLink(token: string, botUsername = readTelegramBotUsername()) {
  return botUsername ? `https://t.me/${botUsername}?start=${encodeURIComponent(token)}` : null;
}

export function buildTelegramStartCommand(token: string) {
  return `/start ${token}`;
}
