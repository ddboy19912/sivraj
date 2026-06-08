import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { createOpenAICompatibleChatGenerator } from "@sivraj/llm";
import { auditEvents, llmProviderConfigs } from "@sivraj/db";
import { and, eq } from "drizzle-orm";
import type { Context } from "hono";
import type { AppDependencies } from "../app.js";
import type { AuthEnv } from "../middleware/auth.js";
import { authorizeTwinRoute, type AuthorizedTwin } from "../lib/http/route-auth.js";
import { optionalString } from "../lib/http/route-helpers.js";
import {
  errorMessage,
  normalizeBaseUrl,
  PROVIDER_DEFAULTS,
  type ProviderKind,
  type ProviderRuntimeConfig,
  defaultBaseUrl,
  providerLabel,
} from "../lib/chat/helpers.js";

export async function handleGetProviderConfig(
  c: Context<AuthEnv>,
  db: AppDependencies["db"],
) {
  const routeAuth = authorizeTwinRoute(c);
  if (!routeAuth.ok) {
    return routeAuth.response;
  }
  const { twinId } = routeAuth.value;
  const config = await loadProviderConfig(db, twinId);
  const envConfig = readEnvProviderConfig(process.env);

  return c.json({
    config: config ? toSafeProviderConfig(config) : null,
    fallback: envConfig
      ? {
          providerKind: envConfig.providerKind,
          displayName: envConfig.displayName,
          baseUrl: envConfig.baseUrl,
          model: envConfig.model,
          source: "env",
        }
      : null,
  });
}

export async function handlePutProviderConfig(
  c: Context<AuthEnv>,
  db: AppDependencies["db"],
) {
  const routeAuth = authorizeTwinRoute(c, "memory:read");
  if (!routeAuth.ok) {
    return routeAuth.response;
  }

  return saveProviderConfig(c, db, routeAuth.value);
}

export async function handleTestProviderConfig(
  c: Context<AuthEnv>,
  db: AppDependencies["db"],
  llmFetch: AppDependencies["llmFetch"],
) {
  const routeAuth = authorizeTwinRoute(c, "memory:read");
  if (!routeAuth.ok) {
    return routeAuth.response;
  }
  const { twinId } = routeAuth.value;
  const body = await c.req.json().catch(() => null);
  const parsed = body && typeof body === "object"
    ? readProviderConfigInput(body)
    : null;
  const runtimeConfig = parsed
    ? runtimeConfigFromInput(parsed, optionalString((body as Record<string, unknown>)["apiKey"]))
    : await resolveRuntimeProviderConfig(db, twinId, process.env);

  if (!runtimeConfig) {
    return c.json({ error: "llm_provider_not_configured" }, 503);
  }

  try {
    const output = await createOpenAICompatibleChatGenerator({
      provider: runtimeConfig.providerKind,
      apiKey: runtimeConfig.apiKey,
      model: runtimeConfig.model,
      baseUrl: runtimeConfig.baseUrl,
      fetch: llmFetch,
      maxRetries: 0,
      timeoutMs: 15_000,
    }).generateChat({
      messages: [
        { role: "system", content: "Reply with a short connection confirmation for Sivraj." },
        { role: "user", content: "Connection test." },
      ],
      temperature: 0,
    });

    await markProviderTested(db, twinId);

    return c.json({
      ok: true,
      providerKind: runtimeConfig.providerKind,
      model: runtimeConfig.model,
      sample: output.content.slice(0, 240),
    });
  } catch (error) {
    return c.json({ error: "llm_provider_test_failed", message: errorMessage(error) }, 502);
  }
}

export async function handleDeleteProviderConfig(
  c: Context<AuthEnv>,
  db: AppDependencies["db"],
) {
  const routeAuth = authorizeTwinRoute(c, "memory:read");
  if (!routeAuth.ok) {
    return routeAuth.response;
  }
  const { auth, twinId } = routeAuth.value;
  const [config] = await db
    .update(llmProviderConfigs)
    .set({
      status: "disconnected",
      apiKeyCiphertext: null,
      apiKeyIv: null,
      apiKeyTag: null,
      apiKeySha256: null,
      updatedAt: new Date(),
    })
    .where(eq(llmProviderConfigs.twinId, twinId))
    .returning();

  await db.insert(auditEvents).values({
    twinId,
    actorType: auth.type,
    actorId: auth.sub,
    eventType: "chat.llm_provider_config.disconnected",
    resourceType: "llm_provider_config",
    resourceId: config?.id ?? twinId,
    metadata: {},
  });

  return c.json({ ok: true });
}

async function saveProviderConfig(
  c: Context<AuthEnv>,
  db: AppDependencies["db"],
  { auth, twinId }: AuthorizedTwin,
) {
  const prepared = await prepareProviderConfigSave(c, db, twinId);
  if ("response" in prepared) {
    return prepared.response;
  }

  const config = await upsertProviderConfig(
    db,
    twinId,
    prepared.existing,
    prepared.values,
    prepared.encrypted,
  );

  await db.insert(auditEvents).values({
    twinId,
    actorType: auth.type,
    actorId: auth.sub,
    eventType: "chat.llm_provider_config.saved",
    resourceType: "llm_provider_config",
    resourceId: config?.id ?? prepared.existing?.id ?? twinId,
    metadata: {
      providerKind: prepared.parsed.providerKind,
      model: prepared.parsed.model,
      hasApiKey: Boolean(prepared.encrypted || prepared.existing?.apiKeyCiphertext),
    },
  });

  return c.json({
    config: toSafeProviderConfig(config ?? { ...prepared.existing, ...prepared.values }),
  });
}

async function prepareProviderConfigSave(
  c: Context<AuthEnv>,
  db: AppDependencies["db"],
  twinId: string,
) {
  const body = await c.req.json().catch(() => null);
  const parsed = readProviderConfigInput(body);

  if (!parsed) {
    return { response: c.json({ error: "invalid_llm_provider_config" }, 400) };
  }

  const existing = await loadProviderConfig(db, twinId);
  const encrypted = encryptOptionalApiKey(
    optionalString((body as Record<string, unknown>)["apiKey"]),
    process.env,
  );

  if (encrypted === "encryption_failed") {
    return { response: c.json({ error: "llm_credential_encryption_not_configured" }, 503) };
  }

  const apiKeyError = validateProviderApiKeyRequirement(
    parsed.providerKind,
    encrypted,
    Boolean(existing?.apiKeyCiphertext),
  );

  if (apiKeyError) {
    return { response: c.json({ error: apiKeyError }, 400) };
  }

  return {
    parsed,
    existing,
    encrypted,
    values: buildProviderConfigValues({
      twinId,
      parsed,
      encrypted,
      hasExistingApiKey: Boolean(existing?.apiKeyCiphertext),
    }),
  };
}

type EncryptedApiKey = ReturnType<typeof encryptApiKey>;

function encryptOptionalApiKey(
  apiKey: string | null,
  env: Record<string, string | undefined>,
): EncryptedApiKey | null | "encryption_failed" {
  if (!apiKey) {
    return null;
  }

  try {
    return encryptApiKey(apiKey, env);
  } catch (error) {
    console.error("llm provider credential encryption failed", error);
    return "encryption_failed";
  }
}

function validateProviderApiKeyRequirement(
  providerKind: ProviderKind,
  encrypted: EncryptedApiKey | null | "encryption_failed",
  hasExistingApiKey: boolean,
): string | null {
  const requiresApiKey = PROVIDER_DEFAULTS[providerKind].requiresApiKey;

  if (requiresApiKey && !encrypted && !hasExistingApiKey) {
    return "llm_api_key_required";
  }

  return null;
}

function buildProviderConfigValues(input: {
  twinId: string;
  parsed: NonNullable<ReturnType<typeof readProviderConfigInput>>;
  encrypted: EncryptedApiKey | null | "encryption_failed";
  hasExistingApiKey: boolean;
}) {
  const encrypted = input.encrypted === "encryption_failed" ? null : input.encrypted;

  return {
    twinId: input.twinId,
    providerKind: input.parsed.providerKind,
    displayName: input.parsed.displayName,
    baseUrl: input.parsed.baseUrl,
    model: input.parsed.model,
    status: "connected" as const,
    metadata: {
      supportsOpenAICompatibleChat: true,
      apiKeySource: encrypted ? "user" : input.hasExistingApiKey ? "existing" : "none",
    },
    updatedAt: new Date(),
    ...(encrypted
      ? {
          apiKeyCiphertext: encrypted.ciphertext,
          apiKeyIv: encrypted.iv,
          apiKeyTag: encrypted.tag,
          apiKeySha256: encrypted.sha256,
        }
      : {}),
  };
}

async function upsertProviderConfig(
  db: AppDependencies["db"],
  twinId: string,
  existing: Awaited<ReturnType<typeof loadProviderConfig>>,
  values: ReturnType<typeof buildProviderConfigValues>,
  encrypted: EncryptedApiKey | null | "encryption_failed",
) {
  const clearedEncrypted = encrypted === "encryption_failed" ? null : encrypted;

  const [config] = existing
    ? await db
        .update(llmProviderConfigs)
        .set(values)
        .where(and(
          eq(llmProviderConfigs.id, existing.id),
          eq(llmProviderConfigs.twinId, twinId),
        ))
        .returning()
    : await db
        .insert(llmProviderConfigs)
        .values({
          ...values,
          ...(clearedEncrypted
            ? {}
            : {
                apiKeyCiphertext: null,
                apiKeyIv: null,
                apiKeyTag: null,
                apiKeySha256: null,
              }),
        })
        .returning();

  return config;
}

export async function loadProviderConfig(db: AppDependencies["db"], twinId: string) {
  const [config] = await db
    .select()
    .from(llmProviderConfigs)
    .where(eq(llmProviderConfigs.twinId, twinId))
    .limit(1);

  return config ?? null;
}

function toSafeProviderConfig(config: Partial<typeof llmProviderConfigs.$inferSelect>) {
  return {
    id: config.id ?? null,
    providerKind: config.providerKind,
    status: config.status,
    displayName: config.displayName,
    baseUrl: config.baseUrl,
    model: config.model,
    hasApiKey: Boolean(config.apiKeyCiphertext),
    lastTestedAt: config.lastTestedAt instanceof Date ? config.lastTestedAt.toISOString() : null,
    updatedAt: config.updatedAt instanceof Date ? config.updatedAt.toISOString() : null,
  };
}

function readProviderConfigInput(value: unknown) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const providerKind = readProviderKind(record["providerKind"]);

  if (!providerKind) {
    return null;
  }

  const defaults = PROVIDER_DEFAULTS[providerKind];
  const displayName = optionalString(record["displayName"]) ?? defaults.displayName;
  const baseUrl = normalizeBaseUrl(optionalString(record["baseUrl"]) ?? defaults.baseUrl);
  const model = optionalString(record["model"]) ?? defaults.model;

  if (!baseUrl || !model) {
    return null;
  }

  return {
    providerKind,
    displayName,
    baseUrl,
    model,
  };
}

function readProviderKind(value: unknown): ProviderKind | null {
  return typeof value === "string" && value in PROVIDER_DEFAULTS
    ? value as ProviderKind
    : null;
}

function runtimeConfigFromInput(
  input: NonNullable<ReturnType<typeof readProviderConfigInput>>,
  apiKey: string | null,
): ProviderRuntimeConfig | null {
  const defaults = PROVIDER_DEFAULTS[input.providerKind];
  if (defaults.requiresApiKey && !apiKey) {
    return null;
  }

  return {
    id: null,
    providerKind: input.providerKind,
    displayName: input.displayName,
    baseUrl: input.baseUrl,
    model: input.model,
    apiKey: apiKey ?? "",
    source: "user",
  };
}

export async function resolveRuntimeProviderConfig(
  db: AppDependencies["db"],
  twinId: string,
  env: Record<string, string | undefined>,
): Promise<ProviderRuntimeConfig | null> {
  const config = await loadProviderConfig(db, twinId);

  if (config?.status === "connected") {
    const apiKey = config.apiKeyCiphertext
      ? decryptApiKey({
          ciphertext: config.apiKeyCiphertext,
          iv: config.apiKeyIv,
          tag: config.apiKeyTag,
        }, env)
      : "";

    return {
      id: config.id,
      providerKind: config.providerKind,
      displayName: config.displayName,
      baseUrl: config.baseUrl,
      model: config.model,
      apiKey,
      source: "user",
    };
  }

  return readEnvProviderConfig(env);
}

function readEnvProviderConfig(env: Record<string, string | undefined>): ProviderRuntimeConfig | null {
  const providerKind = env["LLM_PROVIDER"] || "openai";
  const apiKey = env["LLM_API_KEY"] ?? "";
  const baseUrl = env["OPENAI_BASE_URL"] || defaultBaseUrl(providerKind);
  const model = env["LLM_MODEL"] || (providerKind === "ollama" ? "llama3.1" : "gpt-4o-mini");

  if (providerKind !== "ollama" && !apiKey) {
    return null;
  }

  return {
    id: null,
    providerKind,
    displayName: providerLabel(providerKind),
    baseUrl,
    model,
    apiKey,
    source: "env",
  };
}

async function markProviderTested(db: AppDependencies["db"], twinId: string) {
  await db
    .update(llmProviderConfigs)
    .set({ lastTestedAt: new Date(), status: "connected", updatedAt: new Date() })
    .where(eq(llmProviderConfigs.twinId, twinId))
    .catch(() => undefined);
}

function encryptApiKey(apiKey: string, env: Record<string, string | undefined>) {
  const key = credentialEncryptionKey(env);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(apiKey, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    ciphertext: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    sha256: createHash("sha256").update(apiKey).digest("hex"),
  };
}

function decryptApiKey(input: {
  ciphertext?: string | null;
  iv?: string | null;
  tag?: string | null;
}, env: Record<string, string | undefined>): string {
  if (!input.ciphertext || !input.iv || !input.tag) {
    return "";
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    credentialEncryptionKey(env),
    Buffer.from(input.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(input.tag, "base64"));

  return Buffer.concat([
    decipher.update(Buffer.from(input.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

function credentialEncryptionKey(env: Record<string, string | undefined>): Buffer {
  const raw = env["LLM_CREDENTIAL_ENCRYPTION_KEY"];

  if (!raw) {
    throw new Error("llm_credential_encryption_key_not_configured");
  }

  const decoded = Buffer.from(raw, raw.length === 64 && /^[a-f0-9]+$/i.test(raw) ? "hex" : "base64");

  if (decoded.length === 32) {
    return decoded;
  }

  return createHash("sha256").update(raw).digest();
}
