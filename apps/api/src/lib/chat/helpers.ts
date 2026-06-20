/** Chat route helpers — auth gate, message loading, and provider/runtime utilities. */
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
    model: "google/gemini-2.5-flash-lite",
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

export type RuntimeCapability =
  | "chat"
  | "embeddings"
  | "speech_to_text"
  | "text_to_speech";

export type RuntimeCapabilityConfig = {
  capability: RuntimeCapability;
  providerKind: string;
  displayName: string;
  baseUrl: string;
  model: string;
  source: "env";
  configured: boolean;
};

export type ProviderRuntimeConfig = {
  id: string | null;
  providerKind: ProviderKind | string;
  displayName: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  source: "user" | "env";
};

/** Authorize the caller and load the thread scoped to the route `threadId` param. */
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

/** Load recent messages for a thread, newest last, with an optional cap. */
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
    turnId: message.turnId,
    role: message.role,
    status: message.status,
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

export function estimateTextTokens(value: string): number {
  return Math.max(1, Math.ceil(value.length / 4));
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

export function runtimeProviderLabel(input: {
  providerKind: string;
  baseUrl: string;
  model: string;
}): string {
  const baseUrl = input.baseUrl.toLowerCase();
  const model = input.model.toLowerCase();

  if (baseUrl.includes("openrouter.ai")) {
    return PROVIDER_DEFAULTS.openrouter.displayName;
  }

  if (baseUrl.includes("generativelanguage.googleapis.com") || model.startsWith("google/") || model.startsWith("gemini-")) {
    return "Google";
  }

  if (input.providerKind === "cartesia" || baseUrl.includes("cartesia.ai")) {
    return "Cartesia";
  }

  return providerLabel(input.providerKind);
}

export function readEnvRuntimeCapabilityDefaults(
  env: Record<string, string | undefined>,
): Record<RuntimeCapability, RuntimeCapabilityConfig> {
  const chatProvider = env["LLM_PROVIDER"] || "openrouter";
  const chatBaseUrl = env["OPENAI_BASE_URL"] || defaultBaseUrl(chatProvider);
  const chatModel = env["LLM_MODEL"] || (
    chatProvider === "ollama"
      ? PROVIDER_DEFAULTS.ollama.model
      : PROVIDER_DEFAULTS.openrouter.model
  );

  const embeddingProvider = env["EMBEDDING_PROVIDER"] || chatProvider;
  const embeddingBaseUrl = env["EMBEDDING_BASE_URL"] || chatBaseUrl;
  const embeddingModel = env["EMBEDDING_MODEL"] || "openai/text-embedding-3-small";

  const speechProvider = "cartesia";
  const speechBaseUrl = env["SPEECH_TO_TEXT_BASE_URL"] || env["CARTESIA_BASE_URL"] || "https://api.cartesia.ai";
  const speechModel = env["SPEECH_TO_TEXT_MODEL"] || "ink-whisper";

  const ttsProvider = env["TEXT_TO_SPEECH_PROVIDER"] || env["VOICE_SERVICE_KIND"] || "cartesia";
  const ttsBaseUrl = env["TEXT_TO_SPEECH_BASE_URL"] || "https://api.cartesia.ai";
  const ttsModel = env["TEXT_TO_SPEECH_MODEL"] || env["CARTESIA_MODEL_ID"] || "sonic-3.5";

  return {
    chat: {
      capability: "chat",
      providerKind: chatProvider,
      displayName: runtimeProviderLabel({
        providerKind: chatProvider,
        baseUrl: chatBaseUrl,
        model: chatModel,
      }),
      baseUrl: chatBaseUrl,
      model: chatModel,
      source: "env",
      configured: chatProvider === "ollama" || Boolean(env["LLM_API_KEY"]),
    },
    embeddings: {
      capability: "embeddings",
      providerKind: embeddingProvider,
      displayName: runtimeProviderLabel({
        providerKind: embeddingProvider,
        baseUrl: embeddingBaseUrl,
        model: embeddingModel,
      }),
      baseUrl: embeddingBaseUrl,
      model: embeddingModel,
      source: "env",
      configured: embeddingProvider === "ollama" || Boolean(env["EMBEDDING_API_KEY"] || env["LLM_API_KEY"]),
    },
    speech_to_text: {
      capability: "speech_to_text",
      providerKind: speechProvider,
      displayName: runtimeProviderLabel({
        providerKind: speechProvider,
        baseUrl: speechBaseUrl,
        model: speechModel,
      }),
      baseUrl: speechBaseUrl,
      model: speechModel,
      source: "env",
      configured: Boolean(env["CARTESIA_API_KEY"]),
    },
    text_to_speech: {
      capability: "text_to_speech",
      providerKind: ttsProvider,
      displayName: runtimeProviderLabel({
        providerKind: ttsProvider,
        baseUrl: ttsBaseUrl,
        model: ttsModel,
      }),
      baseUrl: ttsBaseUrl,
      model: ttsModel,
      source: "env",
      configured: ttsProvider === "none"
        ? false
        : Boolean(env["TEXT_TO_SPEECH_API_KEY"] || env["CARTESIA_API_KEY"] || env["VOICE_SERVICE_API_KEY"]),
    },
  };
}
