import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
} from "node:crypto";
import { auditEvents, llmProviderConfigs } from "@sivraj/db";
import { and, desc, eq, ne } from "drizzle-orm";
import type { Context } from "hono";
import type { AppDependencies } from "../app.js";
import type { AuthEnv } from "../middleware/auth.js";
import { authorizeTwinRoute, type AuthorizedTwin } from "../lib/http/route-auth.js";
import { optionalString } from "../lib/http/route-helpers.js";
import {
  defaultBaseUrl,
  PROVIDER_DEFAULTS,
  providerLabel,
  type ProviderRuntimeConfig,
} from "../lib/chat/helpers.js";

const OPENROUTER_AUTH_URL = "https://openrouter.ai/auth";
const OPENROUTER_KEY_EXCHANGE_URL = "https://openrouter.ai/api/v1/auth/keys";
const MAX_OPENROUTER_MODEL_CONFIGS = 3;
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const LLM_CREDENTIAL_ENCRYPTION_MESSAGE =
  "LLM_CREDENTIAL_ENCRYPTION_KEY is required before connecting OAuth or saving provider credentials.";

export async function handleGetProviderConfig(
  c: Context<AuthEnv>,
  db: AppDependencies["db"],
) {
  const routeAuth = authorizeTwinRoute(c);
  if (!routeAuth.ok) {
    return routeAuth.response;
  }

  const { twinId } = routeAuth.value;
  const configs = await loadProviderConfigs(db, twinId);
  const activeConfig = configs.find((config) => config.isActive) ?? null;
  const envConfig = readEnvProviderConfig(process.env);

  return c.json(providerConfigResponse({
    activeConfig,
    configs,
    envConfig,
  }));
}

export async function handleStartOpenRouterOAuth(
  c: Context<AuthEnv>,
) {
  const routeAuth = authorizeTwinRoute(c, "memory:read");
  if (!routeAuth.ok) {
    return routeAuth.response;
  }

  const body = await c.req.json().catch(() => null);
  const callbackUrl = optionalString(
    body && typeof body === "object"
      ? (body as Record<string, unknown>)["callbackUrl"]
      : null,
  );

  if (!callbackUrl || !/^https?:\/\//i.test(callbackUrl)) {
    return c.json({ error: "invalid_openrouter_callback_url" }, 400);
  }

  const codeVerifier = base64Url(randomBytes(48));
  const codeChallenge = base64Url(createHash("sha256").update(codeVerifier).digest());
  const state = safeSignOAuthState({
    twinId: routeAuth.value.twinId,
    nonce: base64Url(randomBytes(18)),
    exp: Date.now() + OAUTH_STATE_TTL_MS,
  }, process.env);

  if (!state) {
    return c.json({
      error: "llm_credential_encryption_not_configured",
      message: LLM_CREDENTIAL_ENCRYPTION_MESSAGE,
    }, 503);
  }
  const authUrl = new URL(OPENROUTER_AUTH_URL);
  authUrl.searchParams.set("callback_url", callbackUrl);
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("state", state);

  return c.json({
    authUrl: authUrl.toString(),
    codeVerifier,
    state,
  });
}

export async function handleCompleteOpenRouterOAuth(
  c: Context<AuthEnv>,
  db: AppDependencies["db"],
  llmFetch: AppDependencies["llmFetch"],
) {
  const routeAuth = authorizeTwinRoute(c, "memory:read");
  if (!routeAuth.ok) {
    return routeAuth.response;
  }

  const body = await c.req.json().catch(() => null);
  const record = body && typeof body === "object"
    ? body as Record<string, unknown>
    : {};
  const code = optionalString(record["code"]);
  const state = optionalString(record["state"]);
  const codeVerifier = optionalString(record["codeVerifier"]);

  if (!code || !state || !codeVerifier) {
    return c.json({ error: "invalid_openrouter_oauth_callback" }, 400);
  }

  const verifiedState = verifyOAuthState(state, process.env);
  if (!verifiedState || verifiedState.twinId !== routeAuth.value.twinId) {
    return c.json({ error: "invalid_openrouter_oauth_state" }, 400);
  }

  const exchanged = await exchangeOpenRouterOAuthCode({
    code,
    codeVerifier,
    fetchImpl: llmFetch ?? fetch,
  });

  if (!exchanged.ok) {
    return c.json({ error: "openrouter_oauth_exchange_failed", message: exchanged.error }, 502);
  }

  const parsed = {
    providerKind: "openrouter" as const,
    displayName: PROVIDER_DEFAULTS.openrouter.displayName,
    baseUrl: PROVIDER_DEFAULTS.openrouter.baseUrl,
    model: PROVIDER_DEFAULTS.openrouter.model,
  };
  const encrypted = encryptOptionalApiKey(exchanged.key, process.env);

  if (encrypted === "encryption_failed" || !encrypted) {
    return c.json({
      error: "llm_credential_encryption_not_configured",
      message: LLM_CREDENTIAL_ENCRYPTION_MESSAGE,
    }, 503);
  }

  const config = await createProviderConfig(db, {
    twinId: routeAuth.value.twinId,
    parsed,
    encrypted,
    isActive: true,
    metadata: {
      supportsOpenAICompatibleChat: true,
      apiKeySource: "openrouter_oauth",
      authMethod: "openrouter_pkce",
    },
  });

  await recordProviderAudit(db, routeAuth.value, {
    eventType: "chat.llm_provider_config.openrouter_oauth_connected",
    resourceId: config?.id ?? routeAuth.value.twinId,
    metadata: { providerKind: "openrouter", model: parsed.model },
  });

  const configs = await loadProviderConfigs(db, routeAuth.value.twinId);

  return c.json(providerConfigResponse({
    activeConfig: config ?? configs.find((item) => item.isActive) ?? null,
    configs,
    envConfig: readEnvProviderConfig(process.env),
  }));
}

export async function handleSelectProviderConfig(
  c: Context<AuthEnv>,
  db: AppDependencies["db"],
) {
  const routeAuth = authorizeTwinRoute(c, "memory:read");
  if (!routeAuth.ok) {
    return routeAuth.response;
  }

  const providerConfigId = readUuid(c.req.param("providerConfigId"));
  if (!providerConfigId) {
    return c.json({ error: "invalid_llm_provider_config_id" }, 400);
  }

  const config = await selectProviderConfig(db, routeAuth.value.twinId, providerConfigId);
  if (!config) {
    return c.json({ error: "llm_provider_config_not_found" }, 404);
  }

  await recordProviderAudit(db, routeAuth.value, {
    eventType: "chat.llm_provider_config.selected",
    resourceId: config.id,
    metadata: { providerKind: config.providerKind, model: config.model },
  });

  const configs = await loadProviderConfigs(db, routeAuth.value.twinId);

  return c.json(providerConfigResponse({
    activeConfig: config,
    configs,
    envConfig: readEnvProviderConfig(process.env),
  }));
}

export async function handleSelectFallbackProviderConfig(
  c: Context<AuthEnv>,
  db: AppDependencies["db"],
) {
  const routeAuth = authorizeTwinRoute(c, "memory:read");
  if (!routeAuth.ok) {
    return routeAuth.response;
  }

  await clearActiveProviderConfigs(db, routeAuth.value.twinId);
  await recordProviderAudit(db, routeAuth.value, {
    eventType: "chat.llm_provider_config.default_selected",
    resourceId: routeAuth.value.twinId,
    metadata: { source: "env" },
  });

  const configs = await loadProviderConfigs(db, routeAuth.value.twinId);

  return c.json(providerConfigResponse({
    activeConfig: null,
    configs,
    envConfig: readEnvProviderConfig(process.env),
  }));
}

export async function handleCreateOpenRouterModelConfig(
  c: Context<AuthEnv>,
  db: AppDependencies["db"],
) {
  const routeAuth = authorizeTwinRoute(c, "memory:read");
  if (!routeAuth.ok) {
    return routeAuth.response;
  }

  const body = await c.req.json().catch(() => null);
  const model = readProviderModel(body);
  if (!model) {
    return c.json({ error: "invalid_llm_provider_model" }, 400);
  }
  const displayName = readProviderDisplayName(body) ?? model;

  const configs = await loadProviderConfigs(db, routeAuth.value.twinId);
  const sourceConfig = configs.find((config) => Boolean(config.apiKeyCiphertext));
  if (!sourceConfig) {
    return c.json({ error: "openrouter_oauth_provider_required" }, 409);
  }
  if (configs.length >= MAX_OPENROUTER_MODEL_CONFIGS) {
    return c.json({
      error: "openrouter_model_limit_reached",
      maxModels: MAX_OPENROUTER_MODEL_CONFIGS,
    }, 409);
  }

  const config = await createOpenRouterModelConfig(db, {
    twinId: routeAuth.value.twinId,
    sourceConfig,
    displayName,
    model,
  });

  await recordProviderAudit(db, routeAuth.value, {
    eventType: "chat.llm_provider_config.openrouter_model_created",
    resourceId: config?.id ?? routeAuth.value.twinId,
    metadata: { providerKind: "openrouter", model },
  });

  const nextConfigs = await loadProviderConfigs(db, routeAuth.value.twinId);
  const activeConfig = nextConfigs.find((item) => item.isActive) ?? config ?? null;

  return c.json(providerConfigResponse({
    activeConfig,
    configs: nextConfigs,
    envConfig: readEnvProviderConfig(process.env),
  }));
}

export async function handleUpdateProviderModel(
  c: Context<AuthEnv>,
  db: AppDependencies["db"],
) {
  const routeAuth = authorizeTwinRoute(c, "memory:read");
  if (!routeAuth.ok) {
    return routeAuth.response;
  }

  const providerConfigId = readUuid(c.req.param("providerConfigId"));
  if (!providerConfigId) {
    return c.json({ error: "invalid_llm_provider_config_id" }, 400);
  }

  const body = await c.req.json().catch(() => null);
  const model = readProviderModel(body);
  if (!model) {
    return c.json({ error: "invalid_llm_provider_model" }, 400);
  }
  const displayName = readProviderDisplayName(body) ?? model;

  const existing = await loadProviderConfigById(
    db,
    routeAuth.value.twinId,
    providerConfigId,
  );
  if (!existing || !isOpenRouterOAuthProviderConfig(existing)) {
    return c.json({ error: "llm_provider_config_not_found" }, 404);
  }

  await updateProviderConfigModel(db, routeAuth.value.twinId, providerConfigId, {
    displayName,
    model,
  });
  await recordProviderAudit(db, routeAuth.value, {
    eventType: "chat.llm_provider_config.updated",
    resourceId: providerConfigId,
    metadata: { providerKind: existing.providerKind, displayName, model },
  });

  const configs = await loadProviderConfigs(db, routeAuth.value.twinId);
  const activeConfig = configs.find((item) => item.isActive) ?? null;

  return c.json(providerConfigResponse({
    activeConfig,
    configs,
    envConfig: readEnvProviderConfig(process.env),
  }));
}

export async function handleDeleteProviderConfig(
  c: Context<AuthEnv>,
  db: AppDependencies["db"],
) {
  const routeAuth = authorizeTwinRoute(c, "memory:read");
  if (!routeAuth.ok) {
    return routeAuth.response;
  }

  const providerConfigId = readUuid(c.req.param("providerConfigId"));
  if (!providerConfigId) {
    return c.json({ error: "invalid_llm_provider_config_id" }, 400);
  }

  const config = await disconnectProviderConfig(db, routeAuth.value.twinId, providerConfigId);
  if (!config) {
    return c.json({ error: "llm_provider_config_not_found" }, 404);
  }

  await recordProviderAudit(db, routeAuth.value, {
    eventType: "chat.llm_provider_config.deleted",
    resourceId: config.id,
    metadata: { providerKind: config.providerKind },
  });

  const configs = await loadProviderConfigs(db, routeAuth.value.twinId);
  const activeConfig = configs.find((item) => item.isActive) ?? null;

  return c.json(providerConfigResponse({
    activeConfig,
    configs,
    envConfig: readEnvProviderConfig(process.env),
  }));
}

type EncryptedApiKey = ReturnType<typeof encryptApiKey>;
type ProviderConfigRow = typeof llmProviderConfigs.$inferSelect;
type OAuthProviderConfigInput = {
  providerKind: "openrouter";
  displayName: string;
  baseUrl: string;
  model: string;
};

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

async function createProviderConfig(db: AppDependencies["db"], input: {
  twinId: string;
  parsed: OAuthProviderConfigInput;
  encrypted: EncryptedApiKey | null;
  isActive: boolean;
  metadata: Record<string, unknown>;
}) {
  if (input.isActive) {
    await clearActiveProviderConfigs(db, input.twinId);
  }

  const [config] = await db
    .insert(llmProviderConfigs)
    .values({
      twinId: input.twinId,
      providerKind: input.parsed.providerKind,
      displayName: input.parsed.displayName,
      baseUrl: input.parsed.baseUrl,
      model: input.parsed.model,
      status: "connected",
      isActive: input.isActive,
      metadata: input.metadata,
      ...(input.encrypted
        ? {
            apiKeyCiphertext: input.encrypted.ciphertext,
            apiKeyIv: input.encrypted.iv,
            apiKeyTag: input.encrypted.tag,
            apiKeySha256: input.encrypted.sha256,
          }
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

async function createOpenRouterModelConfig(db: AppDependencies["db"], input: {
  twinId: string;
  sourceConfig: ProviderConfigRow;
  displayName: string;
  model: string;
}) {
  await clearActiveProviderConfigs(db, input.twinId);

  const [config] = await db
    .insert(llmProviderConfigs)
    .values({
      twinId: input.twinId,
      providerKind: "openrouter",
      displayName: input.displayName,
      baseUrl: PROVIDER_DEFAULTS.openrouter.baseUrl,
      model: input.model,
      status: "connected",
      isActive: true,
      metadata: {
        supportsOpenAICompatibleChat: true,
        apiKeySource: "openrouter_oauth",
        authMethod: "openrouter_pkce",
        credentialSourceProviderConfigId: input.sourceConfig.id,
      },
      apiKeyCiphertext: input.sourceConfig.apiKeyCiphertext,
      apiKeyIv: input.sourceConfig.apiKeyIv,
      apiKeyTag: input.sourceConfig.apiKeyTag,
      apiKeySha256: input.sourceConfig.apiKeySha256,
    })
    .returning();

  return config;
}

async function clearActiveProviderConfigs(
  db: AppDependencies["db"],
  twinId: string,
  exceptProviderConfigId?: string,
) {
  await db
    .update(llmProviderConfigs)
    .set({ isActive: false, updatedAt: new Date() })
    .where(exceptProviderConfigId
      ? and(
          eq(llmProviderConfigs.twinId, twinId),
          ne(llmProviderConfigs.id, exceptProviderConfigId),
        )
      : eq(llmProviderConfigs.twinId, twinId));
}

async function selectProviderConfig(
  db: AppDependencies["db"],
  twinId: string,
  providerConfigId: string,
) {
  const existing = await loadProviderConfigById(db, twinId, providerConfigId);
  if (
    !existing ||
    existing.status !== "connected" ||
    !isOpenRouterOAuthProviderConfig(existing)
  ) {
    return null;
  }

  await clearActiveProviderConfigs(db, twinId, providerConfigId);

  const [config] = await db
    .update(llmProviderConfigs)
    .set({ isActive: true, updatedAt: new Date() })
    .where(and(
      eq(llmProviderConfigs.id, providerConfigId),
      eq(llmProviderConfigs.twinId, twinId),
    ))
    .returning();

  return config ?? existing;
}

async function disconnectProviderConfig(
  db: AppDependencies["db"],
  twinId: string,
  providerConfigId: string,
) {
  const [config] = await db
    .update(llmProviderConfigs)
    .set({
      status: "disconnected",
      isActive: false,
      apiKeyCiphertext: null,
      apiKeyIv: null,
      apiKeyTag: null,
      apiKeySha256: null,
      updatedAt: new Date(),
    })
    .where(and(
      eq(llmProviderConfigs.id, providerConfigId),
      eq(llmProviderConfigs.twinId, twinId),
    ))
    .returning();

  return config;
}

async function updateProviderConfigModel(
  db: AppDependencies["db"],
  twinId: string,
  providerConfigId: string,
  input: {
    displayName: string;
    model: string;
  },
) {
  const [config] = await db
    .update(llmProviderConfigs)
    .set({
      displayName: input.displayName,
      model: input.model,
      updatedAt: new Date(),
    })
    .where(and(
      eq(llmProviderConfigs.id, providerConfigId),
      eq(llmProviderConfigs.twinId, twinId),
    ))
    .returning();

  return config ?? null;
}

export async function loadProviderConfig(db: AppDependencies["db"], twinId: string) {
  return loadActiveProviderConfig(db, twinId);
}

export async function loadActiveProviderConfig(db: AppDependencies["db"], twinId: string) {
  const [config] = await db
    .select()
    .from(llmProviderConfigs)
    .where(and(
      eq(llmProviderConfigs.twinId, twinId),
      eq(llmProviderConfigs.isActive, true),
      eq(llmProviderConfigs.status, "connected"),
    ))
    .limit(1);

  return config && isOpenRouterOAuthProviderConfig(config) ? config : null;
}

async function loadProviderConfigs(db: AppDependencies["db"], twinId: string) {
  const configs = await db
    .select()
    .from(llmProviderConfigs)
    .where(and(
      eq(llmProviderConfigs.twinId, twinId),
      ne(llmProviderConfigs.status, "disconnected"),
    ))
    .orderBy(desc(llmProviderConfigs.isActive), desc(llmProviderConfigs.updatedAt));

  return configs.filter(isOpenRouterOAuthProviderConfig);
}

async function loadProviderConfigById(
  db: AppDependencies["db"],
  twinId: string,
  providerConfigId: string,
) {
  const [config] = await db
    .select()
    .from(llmProviderConfigs)
    .where(and(
      eq(llmProviderConfigs.id, providerConfigId),
      eq(llmProviderConfigs.twinId, twinId),
    ))
    .limit(1);

  return config ?? null;
}

function providerConfigResponse(input: {
  activeConfig: ProviderConfigRow | null;
  configs: ProviderConfigRow[];
  envConfig: ProviderRuntimeConfig | null;
}) {
  const safeActiveConfig = input.activeConfig
    ? toSafeProviderConfig(input.activeConfig)
    : null;

  return {
    config: safeActiveConfig,
    activeConfig: safeActiveConfig,
    configs: input.configs.map(toSafeProviderConfig),
    fallback: input.envConfig
      ? {
          providerKind: input.envConfig.providerKind,
          displayName: input.envConfig.displayName,
          baseUrl: input.envConfig.baseUrl,
          model: input.envConfig.model,
          source: "env",
        }
      : null,
  };
}

function toSafeProviderConfig(config: Partial<ProviderConfigRow>) {
  return {
    id: config.id ?? null,
    providerKind: config.providerKind,
    status: config.status,
    isActive: Boolean(config.isActive),
    authMethod: readProviderAuthMethod(config.metadata),
    displayName: config.displayName,
    baseUrl: config.baseUrl,
    model: config.model,
    hasApiKey: Boolean(config.apiKeyCiphertext),
    lastTestedAt: config.lastTestedAt instanceof Date ? config.lastTestedAt.toISOString() : null,
    updatedAt: config.updatedAt instanceof Date ? config.updatedAt.toISOString() : null,
  };
}

function readProviderAuthMethod(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return "none";
  }

  const authMethod = (metadata as Record<string, unknown>)["authMethod"];
  return authMethod === "openrouter_pkce" ? authMethod : "none";
}

function readProviderModel(body: unknown) {
  const value = body && typeof body === "object"
    ? optionalString((body as Record<string, unknown>)["model"])
    : null;
  const model = value?.trim();

  if (!model || model.length > 180 || /\s/.test(model)) {
    return null;
  }

  return model;
}

function readProviderDisplayName(body: unknown) {
  const value = body && typeof body === "object"
    ? optionalString((body as Record<string, unknown>)["displayName"])
    : null;
  const displayName = value?.trim();

  if (!displayName) {
    return null;
  }

  return displayName.length <= 80 ? displayName : displayName.slice(0, 80);
}

function runtimeConfigFromSavedConfig(
  config: ProviderConfigRow,
  env: Record<string, string | undefined>,
): ProviderRuntimeConfig | null {
  if (config.status !== "connected") {
    return null;
  }

  if (!isOpenRouterOAuthProviderConfig(config)) {
    return null;
  }

  const apiKey = config.apiKeyCiphertext
    ? decryptApiKey({
        ciphertext: config.apiKeyCiphertext,
        iv: config.apiKeyIv,
        tag: config.apiKeyTag,
      }, env)
    : "";

  if (PROVIDER_DEFAULTS[config.providerKind].requiresApiKey && !apiKey) {
    return null;
  }

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

export async function resolveRuntimeProviderConfig(
  db: AppDependencies["db"],
  twinId: string,
  env: Record<string, string | undefined>,
): Promise<ProviderRuntimeConfig | null> {
  const config = await loadActiveProviderConfig(db, twinId);

  if (config) {
    return runtimeConfigFromSavedConfig(config, env);
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

function isOpenRouterOAuthProviderConfig(config: ProviderConfigRow) {
  return config.providerKind === "openrouter" &&
    readProviderAuthMethod(config.metadata) === "openrouter_pkce";
}

async function exchangeOpenRouterOAuthCode(input: {
  code: string;
  codeVerifier: string;
  fetchImpl: typeof fetch;
}): Promise<{ ok: true; key: string } | { ok: false; error: string }> {
  const response = await input.fetchImpl(OPENROUTER_KEY_EXCHANGE_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      code: input.code,
      code_verifier: input.codeVerifier,
      code_challenge_method: "S256",
    }),
  });

  const payload = await response.json().catch(() => ({}));
  const key = payload && typeof payload === "object"
    ? optionalString((payload as Record<string, unknown>)["key"])
    : null;

  if (response.ok && key) {
    return { ok: true, key };
  }

  return {
    ok: false,
    error: response.ok
      ? "OpenRouter did not return a key."
      : `${response.status}: ${JSON.stringify(payload).slice(0, 240)}`,
  };
}

async function recordProviderAudit(
  db: AppDependencies["db"],
  { auth, twinId }: AuthorizedTwin,
  input: {
    eventType: string;
    resourceId: string;
    metadata: Record<string, unknown>;
  },
) {
  await db.insert(auditEvents).values({
    twinId,
    actorType: auth.type,
    actorId: auth.sub,
    eventType: input.eventType,
    resourceType: "llm_provider_config",
    resourceId: input.resourceId,
    metadata: input.metadata,
  });
}

function signOAuthState(
  payload: { twinId: string; nonce: string; exp: number },
  env: Record<string, string | undefined>,
) {
  const encoded = base64Url(Buffer.from(JSON.stringify(payload), "utf8"));
  const signature = createHmac("sha256", credentialEncryptionKey(env))
    .update(encoded)
    .digest();

  return `${encoded}.${base64Url(signature)}`;
}

function safeSignOAuthState(
  payload: { twinId: string; nonce: string; exp: number },
  env: Record<string, string | undefined>,
) {
  try {
    return signOAuthState(payload, env);
  } catch {
    return null;
  }
}

function verifyOAuthState(
  state: string,
  env: Record<string, string | undefined>,
): { twinId: string; nonce: string; exp: number } | null {
  const [encoded, signature] = state.split(".");
  if (!encoded || !signature) {
    return null;
  }

  const expected = base64Url(
    createHmac("sha256", credentialEncryptionKey(env)).update(encoded).digest(),
  );
  if (signature !== expected) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    ) as { twinId?: unknown; nonce?: unknown; exp?: unknown };

    if (
      typeof payload.twinId !== "string" ||
      typeof payload.nonce !== "string" ||
      typeof payload.exp !== "number" ||
      payload.exp < Date.now()
    ) {
      return null;
    }

    return {
      twinId: payload.twinId,
      nonce: payload.nonce,
      exp: payload.exp,
    };
  } catch {
    return null;
  }
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

function base64Url(value: Buffer) {
  return value.toString("base64url");
}

function readUuid(value: string | undefined): string | null {
  return value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null;
}
