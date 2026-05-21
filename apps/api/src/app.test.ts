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
      },
    });
    expect(insertValue(db.insertCalls[0])).toMatchObject({
      sourceType: "markdown",
    });
    expect(JSON.stringify(insertValue(db.insertCalls[0]))).not.toContain("strategy.md");
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
      },
    });
    expect(insertValue(db.insertCalls[0])).toMatchObject({
      sourceType: "pdf",
    });
    expect(JSON.stringify(insertValue(db.insertCalls[0]))).not.toContain("brief.pdf");
    expect(artifactProcessingQueue.enqueueCalls[0]).toEqual({
      artifactId: "artifact-id",
      twinId: "twin-id",
      sourceType: "pdf",
    });
  });

  it.each([
    ["docx", "brief.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    ["csv", "clients.csv", "text/csv"],
    ["email", "message.eml", "message/rfc822"],
    ["chat_export", "chat.json", "application/json"],
    ["slack_export", "slack.json", "application/json"],
    ["whatsapp_export", "whatsapp.txt", "text/plain"],
    ["browser_history", "chrome-history-export.csv", "text/csv"],
    ["ocr_pdf", "scan.pdf", "application/pdf"],
    ["image", "screenshot.png", "image/png"],
    ["voice_note", "founder-reflection.m4a", "audio/mp4"],
    ["voice_conversation", "voice-conversation.webm", "audio/webm"],
  ] as const)("accepts %s uploads through the encrypted storage path", async (sourceType, title, fileType) => {
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
        sourceType,
        title,
        content: "Extracted source content",
        metadata: {
          fileName: title,
          fileType,
          fileSize: 123,
          uploadKind: "file",
        },
      }),
    });

    expect(response.status).toBe(201);
    expect(privateMemoryStorage.storeCalls[0]).toMatchObject({
      sourceType,
      title,
      content: "Extracted source content",
      metadata: {
        fileName: title,
        fileType,
        fileSize: 123,
        uploadKind: "file",
      },
    });
    expect(insertValue(db.insertCalls[0])).toMatchObject({
      sourceType,
    });
    expect(JSON.stringify(insertValue(db.insertCalls[0]))).not.toContain(title);
    expect(artifactProcessingQueue.enqueueCalls[0]).toEqual({
      artifactId: "artifact-id",
      twinId: "twin-id",
      sourceType,
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

  it("requeues failed artifacts for ingestion retry", async () => {
    const db = createRetryDb({
      id: "artifact-id",
      twinId: "twin-id",
      sourceType: "voice_conversation",
      ingestionStatus: "failed",
      metadata: {
        processing: {
          status: "failed",
          reason: "speech_to_text_failed",
        },
      },
    });
    const artifactProcessingQueue = createFakeArtifactProcessingQueue();
    const app = createApp({ db, artifactProcessingQueue });
    const token = await signSessionToken(
      {
        sub: "user-id",
        type: "user",
        scopes: ["artifact:upload"],
        twinId: "twin-id",
      },
      authConfig,
    );

    const response = await app.request("/v1/twins/twin-id/artifacts/artifact-id/retry", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      artifactId: "artifact-id",
      status: "queued",
      processingJobId: "artifact-id",
      warning: null,
    });
    expect(db.updateCalls[0]).toMatchObject({
      value: {
        ingestionStatus: "queued",
        metadata: {
          processing: {
            status: "queued",
            reason: "retry_requested",
          },
        },
      },
    });
    expect(insertValue(db.insertCalls[0])).toMatchObject({
      eventType: "artifact.retry_requested",
      resourceType: "source_artifact",
      resourceId: "artifact-id",
      metadata: {
        previousStatus: "failed",
        sourceType: "voice_conversation",
      },
    });
    expect(artifactProcessingQueue.enqueueCalls[0]).toEqual({
      artifactId: "artifact-id",
      twinId: "twin-id",
      sourceType: "voice_conversation",
    });
  });

  it("rejects retry for artifacts that are not failed", async () => {
    const db = createRetryDb({
      id: "artifact-id",
      twinId: "twin-id",
      sourceType: "note",
      ingestionStatus: "completed",
      metadata: {},
    });
    const app = createApp({ db });
    const token = await signSessionToken(
      {
        sub: "user-id",
        type: "user",
        scopes: ["artifact:upload"],
        twinId: "twin-id",
      },
      authConfig,
    );

    const response = await app.request("/v1/twins/twin-id/artifacts/artifact-id/retry", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "artifact_not_failed",
      status: "completed",
    });
    expect(db.updateCalls).toEqual([]);
  });
});

describe("GitHub import route", () => {
  it("rejects invalid GitHub repo URLs", async () => {
    const app = createApp({
      db: createFakeDb(),
      privateMemoryStorage: createFakePrivateMemoryStorage(),
      githubImporter: async () => {
        throw new Error("invalid_github_repo_url");
      },
    });
    const token = await signSessionToken(
      {
        sub: "user-id",
        type: "user",
        scopes: ["artifact:upload"],
        twinId: "twin-id",
      },
      authConfig,
    );

    const response = await app.request("/v1/twins/twin-id/imports/github", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ repoUrl: "https://example.com/nope" }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_github_repo_url" });
  });

  it("imports a public GitHub repo through the encrypted storage path", async () => {
    const db = createFakeDb();
    const privateMemoryStorage = createFakePrivateMemoryStorage();
    const artifactProcessingQueue = createFakeArtifactProcessingQueue();
    const app = createApp({
      db,
      privateMemoryStorage,
      artifactProcessingQueue,
      githubImporter: async () => ({
        owner: "sivraj",
        repo: "app",
        repoUrl: "https://github.com/sivraj/app",
        title: "sivraj/app",
        content: "GitHub repository: sivraj/app\n\nFile: README.md\n# Sivraj",
        metadata: {
          importer: "github_public_repo",
          owner: "sivraj",
          repo: "app",
          repoUrl: "https://github.com/sivraj/app",
          description: "Persistent intelligence",
          defaultBranch: "main",
          files: [{ path: "README.md", size: 22, source: "contents_api" }],
          skipped: [],
        },
      }),
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

    const response = await app.request("/v1/twins/twin-id/imports/github", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ repoUrl: "https://github.com/sivraj/app" }),
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      artifactId: "artifact-id",
      status: "queued",
      storageMode: ENCRYPTED_WALRUS_STORAGE_MODE,
      rawStorageRef: "walrus://blob/blob-id",
      github: {
        repoUrl: "https://github.com/sivraj/app",
        owner: "sivraj",
        repo: "app",
        fileCount: 1,
      },
    });
    expect(privateMemoryStorage.storeCalls[0]).toMatchObject({
      sourceType: "github",
      title: "sivraj/app",
      content: "GitHub repository: sivraj/app\n\nFile: README.md\n# Sivraj",
      metadata: {
        importer: "github_public_repo",
        owner: "sivraj",
        repo: "app",
      },
    });
    expect(insertValue(db.insertCalls[0])).toMatchObject({
      sourceType: "github",
    });
    expect(JSON.stringify(insertValue(db.insertCalls[0]))).not.toContain("sivraj/app");
    expect(insertValue(db.insertCalls[1])).toMatchObject({
      eventType: "github_import.created",
      metadata: {
        fileCount: 1,
      },
    });
    expect(artifactProcessingQueue.enqueueCalls[0]).toEqual({
      artifactId: "artifact-id",
      twinId: "twin-id",
      sourceType: "github",
    });
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
        contentStorageRef: "walrus://blob/memory-launch",
      }),
      memoryRow({
        id: "memory-finance",
        contentStorageRef: "walrus://blob/memory-finance",
      }),
    ]);
    const app = createApp({
      db,
      privateMemoryReader: {
        async readPrivateMemory(input) {
          if (input.rawStorageRef === "walrus://blob/memory-launch") {
            return "Launch keeps slipping because UI polish expands late.";
          }

          return "Send finance documents before tax filing.";
        },
      },
    });
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

  it("decrypts encrypted private memory fragments only inside memory read route", async () => {
    const db = createFakeDb([
      memoryRow({
        id: "memory-private",
        contentStorageRef: "walrus://blob/encrypted-fragment",
        contentSha256: "sha256:encrypted",
        metadata: {
          storageMode: "encrypted_walrus",
          sensitivity: "private",
        },
      }),
    ]);
    const app = createApp({
      db,
      privateMemoryReader: {
        async readPrivateMemory(input) {
          expect(input).toEqual({
            rawStorageRef: "walrus://blob/encrypted-fragment",
            artifactId: "artifact-id",
            twinId: "twin-id",
          });

          return "Launch keeps slipping because UI polish expands late.";
        },
      },
    });
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
      body: JSON.stringify({ query: "launch polish", limit: 5 }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      results: [
        {
          id: "memory-private",
          content: "Launch keeps slipping because UI polish expands late.",
        },
      ],
    });
  });

  it("fails closed when encrypted fragments exist but decrypt reader is unavailable", async () => {
    const db = createFakeDb([
      memoryRow({
        contentStorageRef: "walrus://blob/encrypted-fragment",
        metadata: {
          storageMode: "encrypted_walrus",
          sensitivity: "private",
        },
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
      body: JSON.stringify({ query: "launch polish", limit: 5 }),
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "private_memory_reader_not_configured",
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

function createRetryDb(artifact: Record<string, unknown> | null) {
  const insertCalls: unknown[] = [];
  const updateCalls: unknown[] = [];

  return {
    insertCalls,
    updateCalls,
    insert(table: unknown) {
      return {
        values(value: unknown) {
          insertCalls.push({ table, value });

          return {
            returning() {
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
                  return Promise.resolve(artifact ? [artifact] : []);
                },
              };
            },
          };
        },
      };
    },
    update(table: unknown) {
      return {
        set(value: unknown) {
          updateCalls.push({ table, value });

          return {
            where() {
              return {
                returning() {
                  return Promise.resolve([
                    {
                      ...artifact,
                      ...(value as Record<string, unknown>),
                      id: artifact?.id ?? "artifact-id",
                    },
                  ]);
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
    contentStorageRef: "walrus://blob/memory-id",
    contentSha256: null,
    embeddingRef: null,
    metadata: null,
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
