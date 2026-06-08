import { chatMessages, chatThreads } from "@sivraj/db";
import { and, desc, eq } from "drizzle-orm";
import type { Context } from "hono";
import type { AppDependencies } from "../../app.js";
import type { AuthEnv } from "../../middleware/auth.js";
import { authorizeTwinRoute } from "../http/route-auth.js";

export const PROVIDER_DEFAULTS = {
  openai: {
    displayName: "OpenAI",
    baseUrl: "https://api.openai.com",
    model: "gpt-4o-mini",
    requiresApiKey: true,
  },
  openrouter: {
    displayName: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "meta-llama/llama-3.1-8b-instruct:free",
    requiresApiKey: true,
  },
  ollama: {
    displayName: "Ollama",
    baseUrl: "http://localhost:11434/v1",
    model: "llama3.1",
    requiresApiKey: false,
  },
  custom_openai_compatible: {
    displayName: "Custom OpenAI-compatible",
    baseUrl: "https://api.example.com/v1",
    model: "custom-model",
    requiresApiKey: false,
  },
} as const;

export type ProviderKind = keyof typeof PROVIDER_DEFAULTS;

export type ProviderRuntimeConfig = {
  id: string | null;
  providerKind: ProviderKind | string;
  displayName: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  source: "user" | "env";
};

export async function authorizeThread(c: Context<AuthEnv>, db: AppDependencies["db"]) {
  const routeAuth = authorizeTwinRoute(c, "memory:read");
  if (!routeAuth.ok) {
    return { response: routeAuth.response };
  }

  const { twinId } = routeAuth.value;
  const threadId = readUuid(c.req.param("threadId"));

  if (!threadId) {
    return { response: c.json({ error: "invalid_thread_id" }, 400) };
  }

  const [thread] = await db
    .select()
    .from(chatThreads)
    .where(and(eq(chatThreads.id, threadId), eq(chatThreads.twinId, twinId)))
    .limit(1);

  if (!thread) {
    return { response: c.json({ error: "chat_thread_not_found" }, 404) };
  }

  return { twinId, thread };
}

export async function loadThreadMessages(
  db: AppDependencies["db"],
  twinId: string,
  threadId: string,
  limit: number,
) {
  const rows = await db
    .select()
    .from(chatMessages)
    .where(and(eq(chatMessages.twinId, twinId), eq(chatMessages.threadId, threadId)))
    .orderBy(desc(chatMessages.createdAt))
    .limit(limit);

  return [...rows].reverse();
}

export function toThreadResponse(thread: typeof chatThreads.$inferSelect) {
  return {
    id: thread.id,
    title: thread.title,
    llmProviderConfigId: thread.llmProviderConfigId,
    metadata: thread.metadata,
    createdAt: thread.createdAt.toISOString(),
    updatedAt: thread.updatedAt.toISOString(),
  };
}

export function toMessageResponse(message: typeof chatMessages.$inferSelect) {
  return {
    id: message.id,
    threadId: message.threadId,
    role: message.role,
    content: message.content,
    providerKind: message.providerKind,
    model: message.model,
    memoryFragmentIds: message.memoryFragmentIds,
    citations: message.citations,
    usage: message.usage,
    metadata: message.metadata,
    createdAt: message.createdAt.toISOString(),
  };
}

export function recordValue(value: unknown, key: string): unknown {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

function readUuid(value: string | undefined): string | null {
  return value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null;
}

export function readPositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = value ? Number.parseInt(value, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected chat error";
}

export function estimateSavedTokens(values: string[]): number {
  const characters = values.reduce((total, value) => total + value.length, 0);
  return Math.round(characters / 4);
}

export function titleFromMessage(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 64) || "New chat";
}

export function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

export function defaultBaseUrl(providerKind: string): string {
  if (providerKind === "openrouter") {
    return PROVIDER_DEFAULTS.openrouter.baseUrl;
  }

  if (providerKind === "ollama") {
    return PROVIDER_DEFAULTS.ollama.baseUrl;
  }

  return PROVIDER_DEFAULTS.openai.baseUrl;
}

export function providerLabel(providerKind: string): string {
  if (providerKind in PROVIDER_DEFAULTS) {
    return PROVIDER_DEFAULTS[providerKind as ProviderKind].displayName;
  }

  return providerKind;
}
