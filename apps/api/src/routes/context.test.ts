import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import {
  AGENT_CONTEXT_READ_SCOPE,
  signSessionToken,
} from "@sivraj/auth";
import {
  canonicalMemories,
  contextRuntimePackets,
  twinIdentityProfiles,
  twins,
} from "@sivraj/db";
import type { AppDependencies } from "../app.js";
import { createContextRoutes } from "./context.js";

describe("context runtime routes", () => {
  it("resolves hot packet context without Walrus reads", async () => {
    const token = await userToken();
    const app = createContextTestApp(createContextDb({
      runtimeRows: [runtimePacketRow()],
    }));

    const response = await app.request("/v1/twins/twin-1/context/resolve", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({
        surface: "web_chat",
        mode: "answer_context",
        query: "What is my occupation?",
        retrievalDepth: "hot",
      }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      status: "ready",
      cache: {
        packetHitCount: 1,
        walrusReadCount: 0,
        sealDecryptCount: 0,
      },
      policy: {
        surface: "web_chat",
        retrievalDepth: "hot",
        rawArtifactsIncluded: false,
        decryptedMemoryIncluded: false,
      },
    });
    expect(payload.contextItems[0]).toMatchObject({
      content: "Fortune's occupation is software engineer.",
    });
  });

  it("refreshes context packets during warmup when no queue is configured", async () => {
    const token = await userToken();
    const db = createContextDb({
      twinRows: [{ id: "twin-1", name: "Hulk", summary: null }],
      identityRows: [{
        id: "identity-1",
        twinId: "twin-1",
        displayName: "Fortune",
        aliases: [],
        emails: [],
        phones: [],
        handles: {},
        selfDescriptionArtifactId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }],
      canonicalRows: [canonicalOccupationRow()],
    });
    const app = createContextTestApp(db);

    const response = await app.request("/v1/twins/twin-1/context/warmup", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({
        surface: "voice_chat",
        reason: "voice_start",
      }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      status: "already_warm",
    });
    expect(payload.packetIds).toHaveLength(2);
    expect(db.insert).toHaveBeenCalled();
  });

  it("keeps warmup usable when the context warmup queue enqueue fails", async () => {
    const token = await userToken();
    const db = createContextDb({
      twinRows: [{ id: "twin-1", name: "Hulk", summary: null }],
      identityRows: [{
        id: "identity-1",
        twinId: "twin-1",
        displayName: "Fortune",
        aliases: [],
        emails: [],
        phones: [],
        handles: {},
        selfDescriptionArtifactId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }],
      canonicalRows: [canonicalOccupationRow()],
    });
    const enqueueContextWarmup = vi.fn(async () => {
      throw new Error("Custom Id cannot contain :");
    });
    const app = createContextTestApp(db, {
      contextWarmupQueue: {
        enqueueContextWarmup,
        close: vi.fn(),
      } as never,
    });

    const response = await app.request("/v1/twins/twin-1/context/warmup", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({
        surface: "voice_chat",
        reason: "voice_start",
      }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      status: "already_warm",
      warning: "context_warmup_queue_failed",
    });
    expect(payload.packetIds).toHaveLength(2);
    expect(enqueueContextWarmup).toHaveBeenCalledOnce();
    expect(db.insert).toHaveBeenCalled();
  });

  it("requires agent memory-search scope for cold memory search context", async () => {
    const token = await signSessionToken(
      {
        type: "agent",
        sub: "agent-1",
        twinId: "twin-1",
        clientId: "client-1",
        scopes: [AGENT_CONTEXT_READ_SCOPE],
      },
      authConfig(),
    );
    const app = createContextTestApp(createContextDb({
      runtimeRows: [runtimePacketRow()],
    }));

    const response = await app.request("/v1/twins/twin-1/context/resolve", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({
        surface: "mcp",
        mode: "memory_search",
        query: "Find my private memory",
        retrievalDepth: "cold",
        includeEvidence: true,
      }),
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: "missing_scope",
      scope: "agent:memory:search",
    });
  });
});

function createContextTestApp(
  db: AppDependencies["db"],
  overrides: Partial<AppDependencies> = {},
) {
  const app = new Hono();
  app.route("/v1/twins/:twinId/context", createContextRoutes({
    db,
    ...overrides,
  } as AppDependencies));
  return app;
}

function createContextDb(options: {
  runtimeRows?: Array<typeof contextRuntimePackets.$inferSelect>;
  twinRows?: Array<Pick<typeof twins.$inferSelect, "id" | "name" | "summary">>;
  identityRows?: Array<typeof twinIdentityProfiles.$inferSelect>;
  canonicalRows?: Array<typeof canonicalMemories.$inferSelect>;
}): AppDependencies["db"] {
  const runtimeRows = [...(options.runtimeRows ?? [])];

  return {
    select: vi.fn(() => ({
      from: (table: unknown) => selectChain(rowsForTable(table, {
        ...options,
        runtimeRows,
      })),
    })),
    insert: vi.fn((table: unknown) => ({
      values: vi.fn((values: Record<string, unknown>) => ({
        returning: async () => {
          if (table === contextRuntimePackets) {
            const row = {
              ...values,
              id: `${String(values["kind"])}-${runtimeRows.length + 1}`,
              createdAt: new Date(),
              updatedAt: new Date(),
            } as typeof contextRuntimePackets.$inferSelect;
            runtimeRows.push(row);
            return [{ id: row.id }];
          }
          return [{ id: "inserted" }];
        },
      })),
    })),
    update: vi.fn((table: unknown) => ({
      set: vi.fn((values: Record<string, unknown>) => ({
        where: () => ({
          returning: async () => {
            if (table === contextRuntimePackets && runtimeRows[0]) {
              Object.assign(runtimeRows[0], values);
              return [{ id: runtimeRows[0].id }];
            }
            return [{ id: "updated" }];
          },
        }),
      })),
    })),
    delete: vi.fn(),
  } as never;
}

function selectChain(rows: unknown[]) {
  return {
    where: () => ({
      orderBy: () => ({
        limit: async () => rows,
      }),
      limit: async () => rows,
    }),
  };
}

function rowsForTable(
  table: unknown,
  options: {
    runtimeRows: Array<typeof contextRuntimePackets.$inferSelect>;
    twinRows?: Array<Pick<typeof twins.$inferSelect, "id" | "name" | "summary">>;
    identityRows?: Array<typeof twinIdentityProfiles.$inferSelect>;
    canonicalRows?: Array<typeof canonicalMemories.$inferSelect>;
  },
) {
  if (table === contextRuntimePackets) {
    return options.runtimeRows;
  }
  if (table === twins) {
    return options.twinRows ?? [];
  }
  if (table === twinIdentityProfiles) {
    return options.identityRows ?? [];
  }
  if (table === canonicalMemories) {
    return options.canonicalRows ?? [];
  }
  return [];
}

function runtimePacketRow(): typeof contextRuntimePackets.$inferSelect {
  const now = new Date();
  return {
    id: "packet-1",
    twinId: "twin-1",
    kind: "personal_hot_memory",
    scopeKey: "default",
    status: "ready",
    payload: {
      items: [{
        id: "canonical:occupation-1",
        kind: "current_fact",
        label: "occupation",
        content: "Fortune's occupation is software engineer.",
        status: "approved",
        confidenceScore: 0.92,
        sourceRefs: [{
          type: "canonical_memory",
          id: "occupation-1",
          label: "profile:occupation",
        }],
      }],
    },
    sourceRefs: [{
      type: "canonical_memory",
      id: "occupation-1",
      label: "profile:occupation",
    }],
    versionHash: "hash-1",
    generatedAt: now,
    staleAt: null,
    expiresAt: null,
    metadata: {},
    createdAt: now,
    updatedAt: now,
  };
}

function canonicalOccupationRow(): typeof canonicalMemories.$inferSelect {
  const now = new Date();
  return {
    id: "occupation-1",
    twinId: "twin-1",
    memoryType: "fact",
    canonicalKey: "profile:occupation",
    subject: "Fortune",
    status: "approved",
    evidenceCount: 1,
    confidenceScore: 0.92,
    metadata: {
      currentTruth: {
        kind: "profile_fact",
        slot: "occupation",
        value: "software engineer",
      },
    },
    firstSeenAt: now,
    lastSeenAt: now,
    createdAt: now,
    updatedAt: now,
  };
}

async function userToken() {
  return signSessionToken(
    {
      type: "user",
      sub: "user-1",
      twinId: "twin-1",
      scopes: ["memory:read"],
    },
    authConfig(),
  );
}

function authHeaders(token: string) {
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
}

function authConfig() {
  process.env["JWT_SECRET"] = "context-runtime-test-secret";
  process.env["TOKEN_ISSUER"] = "context-runtime-test";
  return {
    jwtSecret: "context-runtime-test-secret",
    tokenIssuer: "context-runtime-test",
  };
}
