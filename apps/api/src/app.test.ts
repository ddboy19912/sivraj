import { signSessionToken, verifySessionToken } from "@sivraj/auth";
import {
  DEFAULT_MANUAL_MEMORY_SENSITIVITY,
  ENCRYPTED_WALRUS_STORAGE_MODE,
} from "@sivraj/core";
import { describe, expect, it } from "vitest";
import { createApp, type AppDependencies } from "./app";

const authConfig = {
  jwtSecret: "test-secret",
  tokenIssuer: "sivraj-test",
};

process.env["JWT_SECRET"] = authConfig.jwtSecret;
process.env["TOKEN_ISSUER"] = authConfig.tokenIssuer;

describe("health routes", () => {
  it("reports encrypted storage readiness from env contract", async () => {
    const previousEnv = snapshotEnv([
      "DATABASE_URL",
      "SUI_RPC_URL",
      "SUI_PRIVATE_KEY",
      "SEAL_PACKAGE_ID",
      "SEAL_POLICY_ID",
      "SEAL_KEY_SERVERS",
      "WALRUS_NETWORK",
      "WALRUS_EPOCHS",
      "WALRUS_UPLOAD_RELAY_URL",
    ]);

    Object.assign(process.env, {
      DATABASE_URL: "postgresql://sivraj:sivraj@localhost:5432/sivraj",
      SUI_RPC_URL: "https://fullnode.testnet.sui.io:443",
      SUI_PRIVATE_KEY: "suiprivkey",
      SEAL_PACKAGE_ID: "0xpackage",
      SEAL_POLICY_ID: "0xpolicy",
      SEAL_KEY_SERVERS: "0xkeyserver",
      WALRUS_NETWORK: "testnet",
      WALRUS_EPOCHS: "5",
      WALRUS_UPLOAD_RELAY_URL: "https://upload-relay.testnet.walrus.space",
    });

    try {
      const app = createApp({ db: createFakeDb() });
      const response = await app.request("/health/storage");

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        ok: true,
        service: "sivraj-api",
        storage: {
          mode: "encrypted_walrus",
          ready: true,
          checks: {
            authConfigured: true,
            databaseConfigured: true,
            sealConfigured: true,
            suiConfigured: true,
            uploadRelayConfigured: true,
            walrusConfigured: true,
          },
        },
      });
    } finally {
      restoreEnv(previousEnv);
    }
  });
});

describe("browser API access", () => {
  it("allows Vite web origins to preflight authenticated JSON routes", async () => {
    const app = createApp({ db: createFakeDb() });

    const response = await app.request("/v1/auth/challenge", {
      method: "OPTIONS",
      headers: {
        origin: "http://localhost:5173",
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type,authorization",
      },
    });

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "http://localhost:5173",
    );
    expect(response.headers.get("access-control-allow-headers")).toContain(
      "authorization",
    );
    expect(response.headers.get("access-control-allow-methods")).toContain("POST");
  });

  it("reports missing auth configuration during wallet sign-in", async () => {
    const jwtSecret = process.env["JWT_SECRET"];
    delete process.env["JWT_SECRET"];
    const app = createApp({ db: createFakeDb() });

    try {
      const response = await app.request("/v1/auth/challenge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ walletAddress: "0x123" }),
      });

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: "auth_not_configured" });
    } finally {
      process.env["JWT_SECRET"] = jwtSecret;
    }
  });

  it("rotates refresh sessions into a new API session without a wallet signature", async () => {
    const db = createRefreshDb();
    const app = createApp({ db });

    const response = await app.request("/v1/auth/refresh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        refreshToken: "refresh-token",
        walletAddress: "0x123",
      }),
    });

    expect(response.status).toBe(200);
    const payload = await response.json() as {
      token: string;
      refreshToken: string;
      expiresAt: string;
      userId: string;
      twinId: string;
      walletAddress: string;
    };

    expect(payload.refreshToken).not.toBe("refresh-token");
    expect(payload.expiresAt).toEqual(expect.any(String));
    expect(payload.userId).toBe("user-id");
    expect(payload.twinId).toBe("twin-id");
    expect(payload.walletAddress).toBe("0x123");
    await expect(verifySessionToken(payload.token, authConfig)).resolves.toMatchObject({
      sub: "user-id",
      type: "user",
      scopes: ["artifact:upload", "memory:read"],
      twinId: "twin-id",
      walletAddress: "0x123",
    });
    expect(db.updateCalls).toHaveLength(1);
    expect(db.insertCalls).toHaveLength(1);
    expect(insertValue(db.insertCalls[0])).toMatchObject({
      userId: "user-id",
      twinId: "twin-id",
      walletAddress: "0x123",
      scopes: ["artifact:upload", "memory:read"],
    });
    expect(insertValue(db.insertCalls[0]).tokenHash).not.toBe("refresh-token");
  });

  it("rejects invalid refresh tokens", async () => {
    const app = createApp({ db: createRefreshDb({ session: null }) });

    const response = await app.request("/v1/auth/refresh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        refreshToken: "bad-refresh-token",
        walletAddress: "0x123",
      }),
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "invalid_refresh_token" });
  });
});

describe("protected artifact route", () => {
  it("rejects missing token", async () => {
    const app = createApp({ db: createFakeDb() });

    const response = await app.request("/v1/twins/twin-id/artifacts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validArtifactBody()),
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "missing_bearer_token" });
  });

  it("rejects invalid token", async () => {
    const app = createApp({ db: createFakeDb() });

    const response = await app.request("/v1/twins/twin-id/artifacts", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer invalid",
      },
      body: JSON.stringify(validArtifactBody()),
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "invalid_bearer_token" });
  });

  it("rejects tokens missing artifact upload scope", async () => {
    const app = createApp({ db: createFakeDb() });
    const token = await signSessionToken(
      {
        sub: "user-id",
        type: "user",
        scopes: ["memory:read"],
        twinId: "twin-id",
      },
      authConfig,
    );

    const response = await app.request("/v1/twins/twin-id/artifacts", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(validArtifactBody()),
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "missing_scope",
      scope: "artifact:upload",
    });
  });

  it("rejects tokens for a different twin", async () => {
    const app = createApp({ db: createFakeDb() });
    const token = await signSessionToken(
      {
        sub: "user-id",
        type: "user",
        scopes: ["artifact:upload"],
        twinId: "other-twin",
      },
      authConfig,
    );

    const response = await app.request("/v1/twins/twin-id/artifacts", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(validArtifactBody()),
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "twin_scope_mismatch" });
  });

  it("creates a queued encrypted artifact and audit event", async () => {
    const db = createFakeDb();
    const app = createApp({
      db,
      privateMemoryStorage: createFakePrivateMemoryStorage(),
      artifactProcessingQueue: createFakeArtifactProcessingQueue(),
    });
    const token = await signSessionToken(
      {
        sub: "user-id",
        type: "user",
        scopes: ["artifact:upload"],
        twinId: "twin-id",
        walletAddress: "0xabc",
      },
      authConfig,
    );

    const response = await app.request("/v1/twins/twin-id/artifacts", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(validArtifactBody()),
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      artifactId: "artifact-id",
      memoryFragmentId: null,
      rawStorageRef: "walrus://blob/blob-id",
      sensitivity: DEFAULT_MANUAL_MEMORY_SENSITIVITY,
      status: "queued",
      storageMode: ENCRYPTED_WALRUS_STORAGE_MODE,
      processingJobId: "artifact-id",
      warning: null,
    });
    expect(db.insertCalls).toHaveLength(2);
    expect(insertValue(db.insertCalls[0])).toMatchObject({
      metadata: {
        sensitivity: DEFAULT_MANUAL_MEMORY_SENSITIVITY,
        storageMode: ENCRYPTED_WALRUS_STORAGE_MODE,
        ciphertextSha256: "ciphertext-hash",
        seal: {
          packageId: "0xpackage",
          policyId: "0xpolicy",
        },
        walrus: {
          blobId: "blob-id",
          blobObjectId: "blob-object-id",
        },
      },
      rawStorageRef: "walrus://blob/blob-id",
    });
    expect(insertValue(db.insertCalls[1])).toMatchObject({
      metadata: {
        sensitivity: DEFAULT_MANUAL_MEMORY_SENSITIVITY,
        storageMode: ENCRYPTED_WALRUS_STORAGE_MODE,
        rawStorageRef: "walrus://blob/blob-id",
      },
    });
    expect(JSON.stringify(db.insertCalls.map(insertValue))).not.toContain("Raw text memory");
  });

  it("accepts markdown uploads through the encrypted storage path", async () => {
    const db = createFakeDb();
    const privateMemoryStorage = createFakePrivateMemoryStorage();
    const artifactProcessingQueue = createFakeArtifactProcessingQueue();
    const app = createApp({ db, privateMemoryStorage, artifactProcessingQueue });
    const token = await signSessionToken(
      {
        sub: "user-id",
        type: "user",
        scopes: ["artifact:upload"],
        twinId: "twin-id",
      },
      authConfig,
    );

    const response = await app.request("/v1/twins/twin-id/artifacts", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        sourceType: "markdown",
        title: "strategy.md",
        content: "# Strategy\nShip faster.",
        metadata: {
          fileName: "strategy.md",
          fileType: "text/markdown",
          fileSize: 23,
          uploadKind: "file",
        },
      }),
    });

    expect(response.status).toBe(201);
    expect(privateMemoryStorage.storeCalls[0]).toMatchObject({
      sourceType: "markdown",
      title: "strategy.md",
      content: "# Strategy\nShip faster.",
      metadata: {
        fileName: "strategy.md",
        fileType: "text/markdown",
        fileSize: 23,
        uploadKind: "file",
        storageMode: ENCRYPTED_WALRUS_STORAGE_MODE,
        sensitivity: DEFAULT_MANUAL_MEMORY_SENSITIVITY,
      },
    });
    expect(insertValue(db.insertCalls[0])).toMatchObject({
      sourceType: "markdown",
      title: "strategy.md",
    });
    expect(artifactProcessingQueue.enqueueCalls[0]).toEqual({
      artifactId: "artifact-id",
      twinId: "twin-id",
      sourceType: "markdown",
    });
  });

  it("accepts PDF text extraction uploads through the encrypted storage path", async () => {
    const db = createFakeDb();
    const privateMemoryStorage = createFakePrivateMemoryStorage();
    const artifactProcessingQueue = createFakeArtifactProcessingQueue();
    const app = createApp({ db, privateMemoryStorage, artifactProcessingQueue });
    const token = await signSessionToken(
      {
        sub: "user-id",
        type: "user",
        scopes: ["artifact:upload"],
        twinId: "twin-id",
      },
      authConfig,
    );

    const response = await app.request("/v1/twins/twin-id/artifacts", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        sourceType: "pdf",
        title: "brief.pdf",
        content: "Founder PDF execution plan",
        metadata: {
          fileName: "brief.pdf",
          fileType: "application/pdf",
          fileSize: 123,
          uploadKind: "file",
        },
      }),
    });

    expect(response.status).toBe(201);
    expect(privateMemoryStorage.storeCalls[0]).toMatchObject({
      sourceType: "pdf",
      title: "brief.pdf",
      content: "Founder PDF execution plan",
      metadata: {
        fileName: "brief.pdf",
        fileType: "application/pdf",
        fileSize: 123,
        uploadKind: "file",
        storageMode: ENCRYPTED_WALRUS_STORAGE_MODE,
        sensitivity: DEFAULT_MANUAL_MEMORY_SENSITIVITY,
      },
    });
    expect(insertValue(db.insertCalls[0])).toMatchObject({
      sourceType: "pdf",
      title: "brief.pdf",
    });
    expect(artifactProcessingQueue.enqueueCalls[0]).toEqual({
      artifactId: "artifact-id",
      twinId: "twin-id",
      sourceType: "pdf",
    });
  });

  it("fails closed when encrypted storage is unavailable", async () => {
    const app = createApp({ db: createFakeDb() });
    const token = await signSessionToken(
      {
        sub: "user-id",
        type: "user",
        scopes: ["artifact:upload"],
        twinId: "twin-id",
      },
      authConfig,
    );

    const response = await app.request("/v1/twins/twin-id/artifacts", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(validArtifactBody()),
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "encrypted_storage_not_configured" });
  });
});

describe("memory retrieval route", () => {
  it("requires memory read scope", async () => {
    const app = createApp({ db: createFakeDb() });
    const token = await signSessionToken(
      {
        sub: "user-id",
        type: "user",
        scopes: ["artifact:upload"],
        twinId: "twin-id",
      },
      authConfig,
    );

    const response = await app.request("/v1/twins/twin-id/memories/search", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ query: "launch blockers" }),
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "missing_scope",
      scope: "memory:read",
    });
  });

  it("returns ranked memory results and writes an audit event", async () => {
    const db = createFakeDb([
      memoryRow({
        id: "memory-launch",
        content: "Launch keeps slipping because UI polish expands late.",
        summary: "Launch execution pattern",
      }),
      memoryRow({
        id: "memory-finance",
        content: "Send finance documents before tax filing.",
        summary: "Finance admin",
      }),
    ]);
    const app = createApp({ db });
    const token = await signSessionToken(
      {
        sub: "user-id",
        type: "user",
        scopes: ["memory:read"],
        twinId: "twin-id",
      },
      authConfig,
    );

    const response = await app.request("/v1/twins/twin-id/memories/search", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ query: "launch UI polish", limit: 5 }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      query: "launch UI polish",
      results: [
        {
          id: "memory-launch",
          sourceArtifactId: "artifact-id",
          content: "Launch keeps slipping because UI polish expands late.",
          summary: "Launch execution pattern",
          matchedTerms: ["launch", "ui", "polish"],
          citation: {
            sourceArtifactId: "artifact-id",
          },
        },
      ],
      policy: {
        rawArtifactsIncluded: false,
        scope: "memory:read",
      },
    });
    expect(insertValue(db.insertCalls[0])).toMatchObject({
      eventType: "memory.search",
      resourceType: "twin",
      resourceId: "twin-id",
      metadata: {
        query: "launch UI polish",
        resultCount: 1,
        memoryFragmentIds: ["memory-launch"],
      },
    });
  });
});

function validArtifactBody() {
  return {
    sourceType: "note",
    title: "Founder note",
    content: "Raw text memory",
    metadata: {},
  };
}

function createFakeDb(memoryRows: unknown[] = []) {
  const insertCalls: unknown[] = [];

  return {
    insertCalls,
    insert(table: unknown) {
      return {
        values(value: unknown) {
          insertCalls.push({ table, value });

          return {
            returning() {
              if (insertCalls.length === 1) {
                return Promise.resolve([
                  { id: "artifact-id", ingestionStatus: "queued" },
                ]);
              }

              return Promise.resolve([]);
            },
          };
        },
      };
    },
    select() {
      return {
        from() {
          return {
            where() {
              return {
                limit() {
                  return Promise.resolve(memoryRows);
                },
              };
            },
          };
        },
      };
    },
  } as unknown as AppDependencies["db"] & { insertCalls: unknown[] };
}

function createRefreshDb({
  session = {
    id: "refresh-session-id",
    userId: "user-id",
    twinId: "twin-id",
    walletAddress: "0x123",
    scopes: ["artifact:upload", "memory:read"],
    expiresAt: new Date(Date.now() + 60_000),
    revokedAt: null,
  },
}: {
  session?: Record<string, unknown> | null;
} = {}) {
  const insertCalls: unknown[] = [];
  const updateCalls: unknown[] = [];

  return {
    insertCalls,
    updateCalls,
    insert(table: unknown) {
      return {
        values(value: unknown) {
          insertCalls.push({ table, value });
          return {};
        },
      };
    },
    update(table: unknown) {
      return {
        set(value: unknown) {
          updateCalls.push({ table, value });
          return {
            where() {
              return Promise.resolve([]);
            },
          };
        },
      };
    },
    select() {
      return {
        from() {
          return {
            where() {
              return {
                limit() {
                  return Promise.resolve(session ? [session] : []);
                },
              };
            },
          };
        },
      };
    },
  } as unknown as AppDependencies["db"] & {
    insertCalls: unknown[];
    updateCalls: unknown[];
  };
}

function memoryRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "memory-id",
    twinId: "twin-id",
    sourceArtifactId: "artifact-id",
    content: "Memory content",
    summary: null,
    embeddingRef: null,
    importanceScore: 0.5,
    confidenceScore: 0.5,
    occurredAt: null,
    createdAt: new Date("2026-05-18T00:00:00.000Z"),
    updatedAt: new Date("2026-05-18T00:00:00.000Z"),
    ...overrides,
  };
}

function insertValue(call: unknown): Record<string, unknown> {
  return (call as { value: Record<string, unknown> }).value;
}

function snapshotEnv(keys: string[]): Record<string, string | undefined> {
  return Object.fromEntries(keys.map((key) => [key, process.env[key]]));
}

function restoreEnv(snapshot: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function createFakePrivateMemoryStorage(): AppDependencies["privateMemoryStorage"] & {
  storeCalls: Parameters<NonNullable<AppDependencies["privateMemoryStorage"]>["storePrivateMemory"]>[0][];
} {
  const storeCalls: Parameters<NonNullable<AppDependencies["privateMemoryStorage"]>["storePrivateMemory"]>[0][] = [];

  return {
    storeCalls,
    async storePrivateMemory(input) {
      storeCalls.push(input);

      return {
        rawStorageRef: "walrus://blob/blob-id",
        ciphertextSha256: "ciphertext-hash",
        seal: {
          packageId: "0xpackage",
          policyId: "0xpolicy",
          threshold: 1,
          keyServerObjectIds: ["0xkeyserver"],
        },
        walrus: {
          blobId: "blob-id",
          blobObjectId: "blob-object-id",
          startEpoch: 1,
          endEpoch: 6,
          size: "123",
        },
      };
    },
  };
}

function createFakeArtifactProcessingQueue(): NonNullable<AppDependencies["artifactProcessingQueue"]> & {
  enqueueCalls: Parameters<
    NonNullable<AppDependencies["artifactProcessingQueue"]>["enqueueArtifactProcessing"]
  >[0][];
} {
  const enqueueCalls: Parameters<
    NonNullable<AppDependencies["artifactProcessingQueue"]>["enqueueArtifactProcessing"]
  >[0][] = [];

  return {
    enqueueCalls,
    async enqueueArtifactProcessing(input) {
      enqueueCalls.push(input);
      return { jobId: input.artifactId };
    },
    async close() {},
  };
}
