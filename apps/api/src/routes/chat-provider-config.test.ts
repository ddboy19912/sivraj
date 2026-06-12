import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { signSessionToken } from "@sivraj/auth";
import type { AppDependencies } from "../app.js";
import { createChatRoutes } from "./chat.js";

describe("chat provider config routes", () => {
  it("starts OpenRouter OAuth with PKCE state and verifier", async () => {
    withAuthEnv();
    const app = createChatTestApp(createNoopDependencies());
    const response = await app.request(
      "/v1/twins/00000000-0000-4000-8000-000000000001/chat/provider-config/openrouter/oauth/start",
      {
        method: "POST",
        body: JSON.stringify({ callbackUrl: "http://localhost:5173/chat" }),
        headers: await authedHeaders(),
      },
    );
    const payload = await response.json() as {
      authUrl?: string;
      codeVerifier?: string;
      state?: string;
    };

    expect(response.status).toBe(200);
    expect(payload.codeVerifier).toEqual(expect.any(String));
    expect(payload.state).toEqual(expect.any(String));
    expect(payload.authUrl).toContain("https://openrouter.ai/auth");
    expect(payload.authUrl).toContain("code_challenge_method=S256");
  });

  it("stores only OpenRouter OAuth providers from the OAuth callback", async () => {
    withAuthEnv();
    const db = createOpenRouterOAuthDb();
    const llmFetch = vi.fn(async () => Response.json({ key: "sk-openrouter-oauth" }));
    const app = createChatTestApp({ db, llmFetch } as never);
    const startResponse = await app.request(
      "/v1/twins/00000000-0000-4000-8000-000000000001/chat/provider-config/openrouter/oauth/start",
      {
        method: "POST",
        body: JSON.stringify({ callbackUrl: "http://localhost:5173/chat" }),
        headers: await authedHeaders(),
      },
    );
    const startPayload = await startResponse.json() as {
      state: string;
      codeVerifier: string;
    };

    const response = await app.request(
      "/v1/twins/00000000-0000-4000-8000-000000000001/chat/provider-config/openrouter/oauth/callback",
      {
        method: "POST",
        body: JSON.stringify({
          code: "oauth-code",
          state: startPayload.state,
          codeVerifier: startPayload.codeVerifier,
        }),
        headers: await authedHeaders(),
      },
    );
    const payload = await response.json() as {
      activeConfig?: {
        providerKind?: string;
        authMethod?: string;
        hasApiKey?: boolean;
        model?: string;
      };
      configs?: Array<{ authMethod?: string }>;
    };

    expect(response.status).toBe(200);
    expect(payload.activeConfig).toMatchObject({
      providerKind: "openrouter",
      authMethod: "openrouter_pkce",
      hasApiKey: true,
      model: "google/gemini-3.1-flash-lite",
    });
    expect(payload.configs).toHaveLength(1);
    expect(db.insertedProvider?.apiKeyCiphertext).toEqual(expect.any(String));
    expect(db.insertedProvider?.metadata).toMatchObject({
      apiKeySource: "openrouter_oauth",
      authMethod: "openrouter_pkce",
    });
  });

  it("updates an OpenRouter OAuth provider name and model without exposing credentials", async () => {
    withAuthEnv();
    process.env["LLM_API_KEY"] = "env-test-key";
    const rows = [
      providerRow({
        id: "00000000-0000-4000-8000-0000000000aa",
        isActive: true,
        model: "google/gemini-3.1-flash-lite",
        metadata: { authMethod: "openrouter_pkce" },
      }),
    ];
    const app = createChatTestApp({
      db: createProviderListDb(rows),
    } as never);

    const response = await app.request(
      "/v1/twins/00000000-0000-4000-8000-000000000001/chat/provider-config/00000000-0000-4000-8000-0000000000aa/model",
      {
        method: "PUT",
        body: JSON.stringify({
          displayName: "Claude writing",
          model: "anthropic/claude-sonnet-4.5",
        }),
        headers: await authedHeaders(),
      },
    );
    const payload = await response.json() as {
      activeConfig?: {
        displayName?: string;
        model?: string;
        hasApiKey?: boolean;
        apiKeyCiphertext?: string;
      };
      configs?: Array<{ displayName?: string; model?: string }>;
    };

    expect(response.status).toBe(200);
    expect(payload.activeConfig).toMatchObject({
      displayName: "Claude writing",
      model: "anthropic/claude-sonnet-4.5",
      hasApiKey: true,
    });
    expect(payload.activeConfig).not.toHaveProperty("apiKeyCiphertext");
    expect(payload.configs?.[0]).toMatchObject({
      displayName: "Claude writing",
      model: "anthropic/claude-sonnet-4.5",
    });
  });

  it("creates a second OpenRouter model using the existing OAuth credential", async () => {
    withAuthEnv();
    process.env["LLM_API_KEY"] = "env-test-key";
    const rows = [
      providerRow({
        id: "00000000-0000-4000-8000-0000000000aa",
        isActive: true,
        model: "google/gemini-3.1-flash-lite",
        apiKeyCiphertext: "existing-ciphertext",
        apiKeyIv: "existing-iv",
        apiKeyTag: "existing-tag",
        apiKeySha256: "existing-sha",
        metadata: { authMethod: "openrouter_pkce" },
      }),
    ];
    const app = createChatTestApp({
      db: createProviderListDb(rows),
    } as never);

    const response = await app.request(
      "/v1/twins/00000000-0000-4000-8000-000000000001/chat/provider-config/openrouter/models",
      {
        method: "POST",
        body: JSON.stringify({
          displayName: "Fast GPT",
          model: "openai/gpt-4o-mini",
        }),
        headers: await authedHeaders(),
      },
    );
    const payload = await response.json() as {
      activeConfig?: {
        id?: string;
        displayName?: string;
        model?: string;
        hasApiKey?: boolean;
        apiKeyCiphertext?: string;
      };
      configs?: Array<{
        id?: string;
        displayName?: string;
        model?: string;
        isActive?: boolean;
      }>;
    };

    expect(response.status).toBe(200);
    expect(payload.activeConfig).toMatchObject({
      id: "00000000-0000-4000-8000-0000000000bb",
      displayName: "Fast GPT",
      model: "openai/gpt-4o-mini",
      hasApiKey: true,
    });
    expect(payload.activeConfig).not.toHaveProperty("apiKeyCiphertext");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ isActive: false });
    expect(rows[1]).toMatchObject({
      isActive: true,
      displayName: "Fast GPT",
      model: "openai/gpt-4o-mini",
      apiKeyCiphertext: "existing-ciphertext",
      apiKeyIv: "existing-iv",
      apiKeyTag: "existing-tag",
      apiKeySha256: "existing-sha",
    });
    expect(payload.configs?.filter((config) => config.isActive)).toHaveLength(1);
  });

  it("rejects a fourth saved OpenRouter model", async () => {
    withAuthEnv();
    process.env["LLM_API_KEY"] = "env-test-key";
    const rows = [
      providerRow({
        id: "00000000-0000-4000-8000-0000000000a1",
        isActive: true,
        model: "google/gemini-3.1-flash-lite",
      }),
      providerRow({
        id: "00000000-0000-4000-8000-0000000000a2",
        model: "openai/gpt-4o-mini",
      }),
      providerRow({
        id: "00000000-0000-4000-8000-0000000000a3",
        model: "anthropic/claude-sonnet-4.5",
      }),
    ];
    const app = createChatTestApp({
      db: createProviderListDb(rows),
    } as never);

    const response = await app.request(
      "/v1/twins/00000000-0000-4000-8000-000000000001/chat/provider-config/openrouter/models",
      {
        method: "POST",
        body: JSON.stringify({
          displayName: "Fourth model",
          model: "meta-llama/llama-3.1-8b-instruct:free",
        }),
        headers: await authedHeaders(),
      },
    );
    const payload = await response.json() as {
      error?: string;
      maxModels?: number;
    };

    expect(response.status).toBe(409);
    expect(payload).toMatchObject({
      error: "openrouter_model_limit_reached",
      maxModels: 3,
    });
    expect(rows).toHaveLength(3);
  });

  it("does not expose legacy manual providers in the safe response", async () => {
    withAuthEnv();
    process.env["LLM_API_KEY"] = "env-test-key";
    process.env["LLM_MODEL"] = "google/gemini-3.1-flash-lite";
    const app = createChatTestApp({
      db: createProviderListDb([
        providerRow({
          id: "00000000-0000-4000-8000-0000000000aa",
          isActive: true,
          metadata: { authMethod: "manual" },
        }),
        providerRow({
          id: "00000000-0000-4000-8000-0000000000bb",
          isActive: false,
          metadata: { authMethod: "openrouter_pkce" },
        }),
      ]),
    } as never);

    const response = await app.request(
      "/v1/twins/00000000-0000-4000-8000-000000000001/chat/provider-config",
      { headers: await authedHeaders() },
    );
    const payload = await response.json() as {
      activeConfig?: unknown;
      fallback?: { model?: string };
      configs?: Array<{ id?: string; authMethod?: string }>;
    };

    expect(response.status).toBe(200);
    expect(payload.activeConfig).toBeNull();
    expect(payload.fallback).toMatchObject({
      model: "google/gemini-3.1-flash-lite",
    });
    expect(payload.configs).toEqual([
      expect.objectContaining({
        id: "00000000-0000-4000-8000-0000000000bb",
        authMethod: "openrouter_pkce",
      }),
    ]);
  });

  it("selects the env fallback provider by clearing the active saved provider", async () => {
    withAuthEnv();
    process.env["LLM_API_KEY"] = "env-test-key";
    process.env["LLM_MODEL"] = "google/gemini-3.1-flash-lite";
    const rows = [
      providerRow({
        id: "00000000-0000-4000-8000-0000000000aa",
        isActive: true,
        metadata: { authMethod: "openrouter_pkce" },
      }),
    ];
    const app = createChatTestApp({
      db: createProviderListDb(rows),
    } as never);

    const response = await app.request(
      "/v1/twins/00000000-0000-4000-8000-000000000001/chat/provider-config/default/select",
      {
        method: "PUT",
        headers: await authedHeaders(),
      },
    );
    const payload = await response.json() as {
      activeConfig?: unknown;
      fallback?: { model?: string };
      configs?: Array<{ isActive?: boolean }>;
    };

    expect(response.status).toBe(200);
    expect(payload.activeConfig).toBeNull();
    expect(payload.fallback).toMatchObject({
      model: "google/gemini-3.1-flash-lite",
    });
    expect(payload.configs?.filter((config) => config.isActive)).toHaveLength(0);
  });
});

type ProviderRow = ReturnType<typeof providerRow>;

type OpenRouterOAuthDb = AppDependencies["db"] & {
  insertedProvider?: Record<string, unknown>;
};

function createChatTestApp(dependencies: AppDependencies) {
  const app = new Hono();
  app.route("/v1/twins/:twinId/chat", createChatRoutes(dependencies));
  return app;
}

function createNoopDependencies(): AppDependencies {
  return {
    db: {
      select: vi.fn(),
      insert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    } as never,
  };
}

function createOpenRouterOAuthDb(): OpenRouterOAuthDb {
  const rows: ProviderRow[] = [];
  const db: OpenRouterOAuthDb = {
    insertedProvider: undefined,
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: async () =>
            [...rows].sort((left, right) => Number(right.isActive) - Number(left.isActive)),
        }),
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: () => {
          if (values["isActive"] === false) {
            for (const row of rows) {
              row.isActive = false;
            }
          }

          return {
            returning: async () => [],
          };
        },
      }),
    }),
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        if ("eventType" in values) {
          return Promise.resolve();
        }

        const row = providerRow({
          ...values,
          id: "00000000-0000-4000-8000-0000000000aa",
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        rows.push(row);
        db.insertedProvider = row;

        return {
          returning: async () => [row],
        };
      },
    }),
    delete: vi.fn(),
  } as never;

  return db;
}

function createProviderListDb(rows: ProviderRow[]): AppDependencies["db"] {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => rows.filter((row) => row.isActive).slice(0, 1),
          orderBy: async () =>
            [...rows].sort((left, right) => Number(right.isActive) - Number(left.isActive)),
        }),
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: () => {
          if (values["isActive"] === false) {
            for (const row of rows) {
              row.isActive = false;
            }
          }

          Object.assign(rows[0], values);

          return {
            returning: async () => [rows[0]],
          };
        },
      }),
    }),
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        if ("eventType" in values) {
          return Promise.resolve();
        }

        const row = providerRow({
          ...values,
          id: rows.length === 1
            ? "00000000-0000-4000-8000-0000000000bb"
            : `00000000-0000-4000-8000-${rows.length.toString(16).padStart(12, "0")}`,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        rows.push(row);

        return {
          returning: async () => [row],
        };
      },
    }),
    delete: vi.fn(),
  } as never;
}

function providerRow(overrides: Partial<{
  id: string;
  twinId: string;
  providerKind: "openrouter";
  status: "connected";
  isActive: boolean;
  displayName: string;
  baseUrl: string;
  model: string;
  apiKeyCiphertext: string | null;
  apiKeyIv: string | null;
  apiKeyTag: string | null;
  apiKeySha256: string | null;
  metadata: Record<string, unknown>;
  lastTestedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}> = {}) {
  return {
    id: "00000000-0000-4000-8000-0000000000aa",
    twinId: "00000000-0000-4000-8000-000000000001",
    providerKind: "openrouter" as const,
    status: "connected" as const,
    isActive: false,
    displayName: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "google/gemini-3.1-flash-lite",
    apiKeyCiphertext: "ciphertext",
    apiKeyIv: "iv",
    apiKeyTag: "tag",
    apiKeySha256: "sha",
    metadata: { supportsOpenAICompatibleChat: true, authMethod: "openrouter_pkce" },
    lastTestedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

async function authedHeaders() {
  const token = await signSessionToken(
    {
      type: "user",
      sub: "user-1",
      twinId: "00000000-0000-4000-8000-000000000001",
      walletAddress: "0xabc",
      scopes: ["memory:read"],
    },
    { jwtSecret: "chat-provider-test-secret", tokenIssuer: "chat-provider-test" },
  );

  return {
    "content-type": "application/json",
    authorization: `Bearer ${token}`,
  };
}

function withAuthEnv() {
  process.env["JWT_SECRET"] = "chat-provider-test-secret";
  process.env["TOKEN_ISSUER"] = "chat-provider-test";
  process.env["LLM_CREDENTIAL_ENCRYPTION_KEY"] = "chat-provider-test-encryption-key";
}
