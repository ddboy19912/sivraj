import { signSessionToken } from "@sivraj/auth";
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

  it("creates a queued artifact, memory fragment, and audit event", async () => {
    const db = createFakeDb();
    const app = createApp({
      db,
      privateMemoryStorage: createFakePrivateMemoryStorage(),
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

function validArtifactBody() {
  return {
    sourceType: "note",
    title: "Founder note",
    content: "Raw text memory",
    metadata: {},
  };
}

function createFakeDb() {
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
                  return Promise.resolve([]);
                },
              };
            },
          };
        },
      };
    },
  } as unknown as AppDependencies["db"] & { insertCalls: unknown[] };
}

function insertValue(call: unknown): Record<string, unknown> {
  return (call as { value: Record<string, unknown> }).value;
}

function createFakePrivateMemoryStorage(): AppDependencies["privateMemoryStorage"] {
  return {
    async storePrivateMemory() {
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
