import {
  AGENT_CONTEXT_READ_SCOPE,
  AGENT_MEMORY_SEARCH_SCOPE,
  AGENT_PROJECT_PROFILE_READ_SCOPE,
  AGENT_SOURCE_READ_SCOPE,
  AGENT_WRITEBACK_CREATE_SCOPE,
  signSessionToken,
  verifySessionToken,
} from "@sivraj/auth";
import {
  apiClients,
  agentWritebacks,
  auditEvents,
  candidateMemories,
  graphEdges,
  graphNodes,
  memoryFragments,
  permissionGrants,
  reflectionRuns,
  sourceArtifacts,
  userFeedbackEvents,
} from "@sivraj/db";
import {
  DEFAULT_MANUAL_MEMORY_SENSITIVITY,
  ENCRYPTED_WALRUS_STORAGE_MODE,
} from "@sivraj/core";
import { createHash } from "node:crypto";
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

  it("mints delegated coding-agent tokens with narrow agent scopes", async () => {
    const db = createAgentLayerDb();
    const app = createApp({ db });
    const userToken = await signSessionToken(
      {
        sub: "user-id",
        type: "user",
        scopes: ["memory:read"],
        twinId: "twin-id",
      },
      authConfig,
    );

    const response = await app.request("/v1/twins/twin-id/agents/tokens", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({
        agentName: "Codex",
        scopes: [AGENT_CONTEXT_READ_SCOPE, AGENT_MEMORY_SEARCH_SCOPE],
        expiresInMinutes: 60,
      }),
    });

    expect(response.status).toBe(201);
    const payload = await response.json() as {
      token: string;
      clientId: string;
      grantId: string;
      scopes: string[];
    };
    expect(payload.clientId).toBe("agent-client-id");
    expect(payload.grantId).toBe("permission-grant-id");
    expect(payload.scopes).toEqual([AGENT_CONTEXT_READ_SCOPE, AGENT_MEMORY_SEARCH_SCOPE]);
    await expect(verifySessionToken(payload.token, authConfig)).resolves.toMatchObject({
      sub: "agent-client-id",
      type: "agent",
      scopes: [AGENT_CONTEXT_READ_SCOPE, AGENT_MEMORY_SEARCH_SCOPE],
      twinId: "twin-id",
      clientId: "agent-client-id",
    });
    expect(db.insertCalls.map((call) => (call as { table: unknown }).table)).toEqual([
      apiClients,
      permissionGrants,
      auditEvents,
    ]);
    expect(insertValue(db.insertCalls[2])).toMatchObject({
      eventType: "agent_token.created",
      resourceType: "api_client",
      resourceId: "agent-client-id",
    });
  });

  it("revokes delegated coding-agent grants by grant id", async () => {
    const db = createAgentLayerDb();
    const app = createApp({ db });
    const userToken = await signSessionToken(
      {
        sub: "user-id",
        type: "user",
        scopes: ["memory:read"],
        twinId: "twin-id",
      },
      authConfig,
    );

    const response = await app.request("/v1/twins/twin-id/agents/clients/71bdf0a1-8967-41e3-9fe8-caf48b7254ae/revoke", {
      method: "POST",
      headers: {
        authorization: `Bearer ${userToken}`,
      },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      grantId: "71bdf0a1-8967-41e3-9fe8-caf48b7254ae",
      clientId: "agent-client-id",
      status: "revoked",
    });
    expect(db.updateCalls).toHaveLength(1);
    expect(updateValue(db.updateCalls[0])).toMatchObject({
      revokedAt: expect.any(Date),
      updatedAt: expect.any(Date),
    });
    expect(insertValue(db.insertCalls.at(-1))).toMatchObject({
      eventType: "agent_client.revoked",
      resourceType: "permission_grant",
      resourceId: "71bdf0a1-8967-41e3-9fe8-caf48b7254ae",
    });
  });

  it("records delegated agent writebacks as encrypted pending-review records", async () => {
    const db = createAgentLayerDb();
    const enqueueCalls: unknown[] = [];
    const app = createApp({
      db,
      privateMemoryStorage: {
        async storePrivateMemory(input) {
          expect(input).toMatchObject({
            twinId: "twin-id",
            sourceType: "note",
            title: "Coding agent writeback: Codex",
            content: expect.stringContaining("## Task Summary"),
            metadata: {
              uploadKind: "agent_writeback",
              importer: "sivraj_agent_api",
              agentName: "Codex",
              clientId: "agent-client-id",
            },
          });

          return {
            rawStorageRef: "walrus://blob/writeback",
            ciphertextSha256: "sha256:writeback",
            encryptedBytesBase64: Buffer.from("encrypted writeback").toString("base64"),
            seal: {
              packageId: "0xpackage",
              policyId: "0xpolicy",
              threshold: 1,
              keyServerObjectIds: ["0xkeyserver"],
            },
            walrus: {
              blobId: "writeback",
              blobObjectId: "0xblob",
              startEpoch: 1,
              endEpoch: 5,
              size: "19",
            },
          };
        },
        async storeEncryptedPrivateMemory() {
          throw new Error("not used");
        },
      },
      artifactProcessingQueue: {
        async enqueueArtifactProcessing(input) {
          enqueueCalls.push(input);
          return { jobId: "writeback-job-id" };
        },
      },
    });
    const token = await signSessionToken(
      {
        sub: "agent-client-id",
        type: "agent",
        scopes: [AGENT_WRITEBACK_CREATE_SCOPE],
        twinId: "twin-id",
        clientId: "agent-client-id",
      },
      authConfig,
    );

    const response = await app.request("/v1/twins/twin-id/agents/writebacks", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        agentName: "Codex",
        repo: "sivraj",
        taskSummary: "Implemented the MCP server.",
        filesTouched: ["apps/mcp-server/src/index.ts"],
        testsRun: ["pnpm --filter @sivraj/mcp-server test"],
      }),
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      writebackId: "agent-writeback-id",
      status: "pending",
      rawStorageRef: "walrus://blob/writeback",
      warning: "agent_writeback_pending_review",
    });
    expect(insertValue(db.insertCalls[0])).toMatchObject({
      status: "pending",
      payload: {
        kind: "coding_agent_writeback",
        agentName: "Codex",
        counts: {
          filesTouched: 1,
          testsRun: 1,
        },
        storage: {
          rawStorageRef: "walrus://blob/writeback",
          ciphertextSha256: "sha256:writeback",
        },
      },
    });
    expect(insertValue(db.insertCalls[1])).toMatchObject({
      eventType: "agent.writeback.created",
      actorType: "agent",
      actorId: "agent-client-id",
      resourceType: "agent_writeback",
      resourceId: "agent-writeback-id",
      metadata: {
        clientId: "agent-client-id",
        status: "pending",
      },
    });
    expect(enqueueCalls).toEqual([]);
  });

  it("accepts client-encrypted delegated agent writebacks without plaintext task summary", async () => {
    const db = createAgentLayerDb();
    const privateMemoryStorage = createFakePrivateMemoryStorage();
    const app = createApp({ db, privateMemoryStorage });
    const encryptedBytes = Buffer.from("client encrypted writeback");
    const token = await signSessionToken(
      {
        sub: "agent-client-id",
        type: "agent",
        scopes: [AGENT_WRITEBACK_CREATE_SCOPE],
        twinId: "twin-id",
        clientId: "agent-client-id",
      },
      authConfig,
    );

    const response = await app.request("/v1/twins/twin-id/agents/writebacks", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        agentName: "Remote Codex",
        repo: "sivraj",
        taskSummarySha256: sha256Hex(Buffer.from("Implemented remote MCP encryption.")),
        counts: {
          filesTouched: 2,
          commandsRun: 1,
          testsRun: 1,
          decisions: 1,
        },
        encryptedPayload: {
          ciphertextBase64: encryptedBytes.toString("base64"),
          ciphertextSha256: sha256Hex(encryptedBytes),
          seal: {
            packageId: "0xpackage",
            policyId: "0xpolicy",
            threshold: 1,
            keyServerObjectIds: ["0xkeyserver"],
          },
        },
      }),
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      writebackId: "agent-writeback-id",
      status: "pending",
      rawStorageRef: "walrus://blob/blob-id",
      warning: "agent_writeback_pending_review",
    });
    expect(privateMemoryStorage.storeCalls).toHaveLength(0);
    expect(privateMemoryStorage.storeEncryptedCalls[0]).toMatchObject({
      twinId: "twin-id",
      sourceType: "note",
      encryptedBytes,
      ciphertextSha256: sha256Hex(encryptedBytes),
      seal: {
        packageId: "0xpackage",
        policyId: "0xpolicy",
      },
    });
    expect(insertValue(db.insertCalls[0])).toMatchObject({
      payload: {
        kind: "coding_agent_writeback",
        agentName: "Remote Codex",
        repo: "sivraj",
        counts: {
          filesTouched: 2,
          commandsRun: 1,
          testsRun: 1,
          decisions: 1,
        },
        storage: {
          encryptionBoundary: "client",
        },
        artifactMetadata: {
          encryptionBoundary: "client",
        },
      },
    });
    expect(JSON.stringify(db.insertCalls.map(insertValue))).not.toContain("Implemented remote MCP encryption.");
  });

  it("rejects agent context assembly when the active grant no longer includes context scope", async () => {
    const app = createApp({ db: createAgentLayerDb() });
    const token = await signSessionToken(
      {
        sub: "agent-client-id",
        type: "agent",
        scopes: [AGENT_CONTEXT_READ_SCOPE],
        twinId: "twin-id",
        clientId: "agent-client-id",
      },
      authConfig,
    );

    const response = await app.request("/v1/twins/twin-id/engineering/context", {
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "agent_grant_inactive" });
  });

  it("imports pull request history as encrypted pending-review writeback", async () => {
    const db = createAgentLayerDb({
      grantScopes: [AGENT_WRITEBACK_CREATE_SCOPE, AGENT_SOURCE_READ_SCOPE],
    });
    const app = createApp({
      db,
      privateMemoryStorage: {
        async storePrivateMemory(input) {
          expect(input).toMatchObject({
            twinId: "twin-id",
            sourceType: "note",
            title: "PR writeback import: Fix memory search",
            content: expect.stringContaining("# Pull Request Writeback Import"),
            metadata: {
              uploadKind: "agent_writeback",
              importer: "sivraj_agent_api",
              writebackKind: "pr_import",
              agentName: "Codex",
              clientId: "agent-client-id",
            },
          });
          expect(input.content).toContain("## Review Comments");
          expect(input.content).toContain("- Avoid fallback-only fixes.");

          return {
            rawStorageRef: "walrus://blob/pr-writeback",
            ciphertextSha256: "sha256:pr-writeback",
            encryptedBytesBase64: Buffer.from("encrypted pr writeback").toString("base64"),
            seal: {
              packageId: "0xpackage",
              policyId: "0xpolicy",
              threshold: 1,
              keyServerObjectIds: ["0xkeyserver"],
            },
            walrus: {
              blobId: "pr-writeback",
              blobObjectId: "0xblob",
              startEpoch: 1,
              endEpoch: 5,
              size: "22",
            },
          };
        },
        async storeEncryptedPrivateMemory() {
          throw new Error("not used");
        },
      },
    });
    const token = await signSessionToken(
      {
        sub: "agent-client-id",
        type: "agent",
        scopes: [AGENT_WRITEBACK_CREATE_SCOPE],
        twinId: "twin-id",
        clientId: "agent-client-id",
      },
      authConfig,
    );

    const response = await app.request("/v1/twins/twin-id/agents/writebacks/imports/pr", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        agentName: "Codex",
        repo: "sivraj",
        number: 42,
        title: "Fix memory search",
        summary: "Stopped retrieval from decrypting too many fragments.",
        filesChanged: ["apps/api/src/routes/memories.ts"],
        reviewComments: ["Avoid fallback-only fixes."],
        testsRun: ["pnpm --filter @sivraj/api test"],
      }),
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      writebackId: "agent-writeback-id",
      kind: "pull_request",
      status: "pending",
      rawStorageRef: "walrus://blob/pr-writeback",
    });
    expect(insertValue(db.insertCalls[0])).toMatchObject({
      payload: {
        kind: "coding_agent_pr_import",
        agentName: "Codex",
        repo: "sivraj",
        identifier: "42",
        counts: {
          filesChanged: 1,
          reviewComments: 1,
          testsRun: 1,
        },
        storage: {
          rawStorageRef: "walrus://blob/pr-writeback",
        },
      },
    });
    expect(insertValue(db.insertCalls[1])).toMatchObject({
      eventType: "agent.writeback_pr_import.created",
      resourceType: "agent_writeback",
      metadata: {
        clientId: "agent-client-id",
        repo: "sivraj",
        identifier: "42",
      },
    });
  });
});

describe("feedback routes", () => {
  it("records candidate memory approval and updates candidate status", async () => {
    const db = createFeedbackDb();
    const app = createApp({ db });
    const token = await signSessionToken(
      {
        sub: "user-id",
        type: "user",
        scopes: ["artifact:upload", "memory:read"],
        twinId: "11111111-1111-4111-8111-111111111111",
        walletAddress: "0xabc",
      },
      authConfig,
    );

    const response = await app.request("/v1/twins/11111111-1111-4111-8111-111111111111/feedback", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        targetType: "candidate_memory",
        targetId: "22222222-2222-4222-8222-222222222222",
        feedbackType: "approved",
        metadata: {
          surface: "candidate_memory_review",
          rank: 1,
        },
      }),
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      feedbackId: "feedback-id",
      targetType: "candidate_memory",
      targetId: "22222222-2222-4222-8222-222222222222",
      feedbackType: "approved",
      candidateMemoryStatus: "approved",
    });
    expect(db.insertCalls).toHaveLength(2);
    expect(db.insertCalls[0]).toMatchObject({ table: userFeedbackEvents });
    expect(insertValue(db.insertCalls[0])).toMatchObject({
      twinId: "11111111-1111-4111-8111-111111111111",
      targetType: "candidate_memory",
      targetId: "22222222-2222-4222-8222-222222222222",
      feedbackType: "approved",
      actorType: "user",
      actorId: "user-id",
      metadata: {
        surface: "candidate_memory_review",
        rank: 1,
      },
    });
    expect(db.updateCalls).toHaveLength(1);
    expect(updateValue(db.updateCalls[0])).toMatchObject({ status: "approved" });
  });

  it("rejects freeform plaintext feedback metadata", async () => {
    const app = createApp({ db: createFeedbackDb() });
    const token = await signSessionToken(
      {
        sub: "user-id",
        type: "user",
        scopes: ["memory:read"],
        twinId: "11111111-1111-4111-8111-111111111111",
      },
      authConfig,
    );

    const response = await app.request("/v1/twins/11111111-1111-4111-8111-111111111111/feedback", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        targetType: "candidate_memory",
        targetId: "22222222-2222-4222-8222-222222222222",
        feedbackType: "wrong",
        metadata: {
          note: "This is private correction text and must not enter Postgres here.",
        },
      }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_feedback_metadata" });
  });
});

describe("conversation review routes", () => {
  const twinId = "11111111-1111-4111-8111-111111111111";
  const artifactId = "22222222-2222-4222-8222-222222222222";
  const candidateId = "33333333-3333-4333-8333-333333333333";

  it("returns a private-safe voice conversation review summary", async () => {
    const db = createConversationReviewDb({ twinId, artifactId, candidateId });
    const app = createApp({ db });
    const token = await signSessionToken(
      {
        sub: "user-id",
        type: "user",
        scopes: ["memory:read"],
        twinId,
      },
      authConfig,
    );

    const response = await app.request(`/v1/twins/${twinId}/conversations/${artifactId}/review`, {
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toMatchObject({
      policy: {
        rawArtifactsIncluded: false,
        approvalRequiredBeforeTwinUpdate: true,
      },
      artifact: {
        id: artifactId,
        sourceType: "voice_conversation",
      },
      summary: {
        artifactId,
        candidateMemoryCount: 1,
        countsByType: {
          decision: 1,
        },
        subjects: ["Sivraj positioning"],
      },
      candidateMemories: [
        {
          id: candidateId,
          subject: "Sivraj positioning",
          statementStorageRef: "walrus://blob/candidate",
        },
      ],
    });
    expect(JSON.stringify(payload)).not.toContain("I decided");
  });

  it("stores encrypted conversation summary and audits generation", async () => {
    const db = createConversationReviewDb({ twinId, artifactId, candidateId });
    const privateMemoryStorage = createFakePrivateMemoryStorage();
    const app = createApp({ db, privateMemoryStorage });
    const token = await signSessionToken(
      {
        sub: "user-id",
        type: "user",
        scopes: ["memory:read"],
        twinId,
      },
      authConfig,
    );

    const response = await app.request(`/v1/twins/${twinId}/conversations/${artifactId}/summary`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      artifactId,
      status: "generated",
      summaryStorageRef: "walrus://blob/blob-id",
    });
    expect(privateMemoryStorage.storeCalls[0]).toMatchObject({
      twinId,
      sourceType: "note",
      title: "Voice conversation review summary",
      metadata: {
        uploadKind: "voice_conversation_summary",
        sourceArtifactId: artifactId,
      },
    });
    expect(updateValue(db.updateCalls[0])).toMatchObject({
      metadata: {
        conversationReview: {
          summary: {
            status: "generated",
            summaryStorageRef: "walrus://blob/blob-id",
          },
        },
      },
    });
    expect(insertValue(db.insertCalls[0])).toMatchObject({
      eventType: "conversation.summary.generated",
      resourceType: "source_artifact",
      resourceId: artifactId,
    });
  });

  it("approves edited voice-derived memories into encrypted ingestion path", async () => {
    const db = createConversationReviewDb({ twinId, artifactId, candidateId });
    const privateMemoryStorage = createFakePrivateMemoryStorage();
    const queueCalls: unknown[] = [];
    const app = createApp({
      db,
      privateMemoryStorage,
      artifactProcessingQueue: {
        async enqueueArtifactProcessing(input) {
          queueCalls.push(input);
          return { jobId: "approved-memory-job-id" };
        },
      },
    });
    const token = await signSessionToken(
      {
        sub: "user-id",
        type: "user",
        scopes: ["memory:read"],
        twinId,
      },
      authConfig,
    );

    const response = await app.request(`/v1/twins/${twinId}/conversations/${artifactId}/memories/review`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        actions: [
          {
            candidateId,
            action: "approve",
            editedStatement: "The user decided to position Sivraj around owned memory.",
          },
        ],
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      artifactId,
      status: "reviewed",
      approvedCount: 1,
      editedArtifactCount: 1,
      results: [
        {
          candidateId,
          status: "approved",
          approvedArtifactId: "approved-conversation-artifact-id",
          processingJobId: "approved-memory-job-id",
        },
      ],
    });
    expect(privateMemoryStorage.storeCalls[0]).toMatchObject({
      twinId,
      sourceType: "note",
      title: "Approved voice conversation memory",
      content: "The user decided to position Sivraj around owned memory.",
      metadata: {
        uploadKind: "approved_voice_conversation_memory",
        sourceArtifactId: artifactId,
        sourceCandidateMemoryId: candidateId,
        voiceDerived: true,
        reviewApproved: true,
      },
    });
    expect(queueCalls).toEqual([
      {
        artifactId: "approved-conversation-artifact-id",
        twinId,
        sourceType: "note",
      },
    ]);
    expect(db.insertCalls.map((call) => (call as { table: unknown }).table)).toContain(userFeedbackEvents);
    expect(JSON.stringify(db.insertCalls.map(insertValue))).toContain("conversation.approved_memory.stored");
    expect(JSON.stringify(db.insertCalls.map(insertValue))).toContain("conversation.memories.reviewed");
  });
});

describe("reflection routes", () => {
  it("creates an on-demand weekly reflection run and queues worker generation", async () => {
    const queue = createFakeWeeklyReflectionQueue();
    const db = createReflectionDb({ existing: null });
    const app = createApp({ db, weeklyReflectionQueue: queue });
    const token = await signSessionToken(
      {
        sub: "user-id",
        type: "user",
        scopes: ["memory:read"],
        twinId: "11111111-1111-4111-8111-111111111111",
      },
      authConfig,
    );

    const response = await app.request("/v1/twins/11111111-1111-4111-8111-111111111111/reflections/weekly", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        periodStart: "2026-05-01T00:00:00.000Z",
        periodEnd: "2026-05-08T00:00:00.000Z",
      }),
    });

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      reflectionRunId: "reflection-run-id",
      jobId: "reflection-run-id",
      status: "queued",
      periodStart: "2026-05-01T00:00:00.000Z",
      periodEnd: "2026-05-08T00:00:00.000Z",
      reused: false,
    });
    expect(queue.enqueueCalls).toEqual([
      {
        reflectionRunId: "reflection-run-id",
        twinId: "11111111-1111-4111-8111-111111111111",
        periodStart: "2026-05-01T00:00:00.000Z",
        periodEnd: "2026-05-08T00:00:00.000Z",
      },
    ]);
    expect(insertValue(db.insertCalls[0])).toMatchObject({
      twinId: "11111111-1111-4111-8111-111111111111",
      status: "queued",
    });
  });

  it("reuses an existing weekly reflection run for the same period", async () => {
    const queue = createFakeWeeklyReflectionQueue();
    const db = createReflectionDb({
      existing: {
        id: "existing-reflection-run-id",
        twinId: "11111111-1111-4111-8111-111111111111",
        periodStart: new Date("2026-05-01T00:00:00.000Z"),
        periodEnd: new Date("2026-05-08T00:00:00.000Z"),
        status: "completed",
        summaryStorageRef: "walrus://blob/reflection",
        summarySha256: "sha256",
        metadata: {},
        createdAt: new Date("2026-05-08T00:00:00.000Z"),
        updatedAt: new Date("2026-05-08T00:00:00.000Z"),
      },
    });
    const app = createApp({ db, weeklyReflectionQueue: queue });
    const token = await signSessionToken(
      {
        sub: "user-id",
        type: "user",
        scopes: ["memory:read"],
        twinId: "11111111-1111-4111-8111-111111111111",
      },
      authConfig,
    );

    const response = await app.request("/v1/twins/11111111-1111-4111-8111-111111111111/reflections/weekly", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        periodStart: "2026-05-01T00:00:00.000Z",
        periodEnd: "2026-05-08T00:00:00.000Z",
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      reflectionRunId: "existing-reflection-run-id",
      status: "completed",
      reused: true,
    });
    expect(queue.enqueueCalls).toEqual([]);
  });

  it("lists reflection runs without decrypting private reflection text", async () => {
    const db = createReflectionDb({
      existing: {
        id: "reflection-run-id",
        twinId: "11111111-1111-4111-8111-111111111111",
        periodStart: new Date("2026-05-01T00:00:00.000Z"),
        periodEnd: new Date("2026-05-08T00:00:00.000Z"),
        status: "completed",
        summaryStorageRef: "walrus://blob/reflection",
        summarySha256: "sha256",
        metadata: { signalCount: 3 },
        createdAt: new Date("2026-05-08T00:00:00.000Z"),
        updatedAt: new Date("2026-05-08T00:00:00.000Z"),
      },
    });
    const app = createApp({ db, weeklyReflectionQueue: createFakeWeeklyReflectionQueue() });
    const token = await signSessionToken(
      {
        sub: "user-id",
        type: "user",
        scopes: ["memory:read"],
        twinId: "11111111-1111-4111-8111-111111111111",
      },
      authConfig,
    );

    const response = await app.request("/v1/twins/11111111-1111-4111-8111-111111111111/reflections", {
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      reflections: [
        {
          id: "reflection-run-id",
          twinId: "11111111-1111-4111-8111-111111111111",
          periodStart: "2026-05-01T00:00:00.000Z",
          periodEnd: "2026-05-08T00:00:00.000Z",
          status: "completed",
          summaryStorageRef: "walrus://blob/reflection",
          summarySha256: "sha256",
          metadata: { signalCount: 3 },
          createdAt: "2026-05-08T00:00:00.000Z",
          updatedAt: "2026-05-08T00:00:00.000Z",
        },
      ],
    });
  });
});

describe("console read routes", () => {
  const twinId = "11111111-1111-4111-8111-111111111111";
  const artifactId = "22222222-2222-4222-8222-222222222222";

  it("returns safe artifact detail metadata", async () => {
    const db = createConsoleReadDb();
    const app = createApp({ db });
    const token = await signSessionToken(
      {
        sub: "user-id",
        type: "user",
        scopes: ["memory:read"],
        twinId,
      },
      authConfig,
    );

    const response = await app.request(`/v1/twins/${twinId}/artifacts/${artifactId}`, {
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      policy: {
        rawArtifactsIncluded: false,
        scope: "memory:read",
      },
      artifact: {
        id: artifactId,
        twinId,
        ingestionStatus: "completed",
        intelligenceStatus: "completed",
        rawStorageRef: "walrus://blob/raw",
        memoryFragment: {
          id: "fragment-id",
          contentStorageRef: "walrus://blob/fragment",
        },
        counts: {
          candidateMemories: 1,
        },
      },
    });
  });

  it("returns privacy checklist without plaintext fields", async () => {
    const db = createConsoleReadDb();
    const app = createApp({ db });
    const token = await signSessionToken(
      {
        sub: "user-id",
        type: "user",
        scopes: ["memory:read"],
        twinId,
      },
      authConfig,
    );

    const response = await app.request(`/v1/twins/${twinId}/artifacts/${artifactId}/privacy-check`, {
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      allChecksPassed: true,
      checklist: {
        sourceArtifactHasRawStorageRef: true,
        sourceArtifactHasCiphertextHash: true,
        sourceArtifactMetadataHasNoPlaintextFields: true,
        memoryFragmentHasContentStorageRef: true,
        candidateMemoriesUseStatementStorageRef: true,
        completedReflectionsUseSummaryStorageRef: true,
      },
    });
  });

  it("lists candidate memories with safe metadata only", async () => {
    const db = createConsoleReadDb();
    const app = createApp({ db });
    const token = await signSessionToken(
      {
        sub: "user-id",
        type: "user",
        scopes: ["memory:read"],
        twinId,
      },
      authConfig,
    );

    const response = await app.request(`/v1/twins/${twinId}/candidate-memories`, {
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      candidateMemories: [
        {
          id: "candidate-id",
          sourceArtifactId: artifactId,
          memoryType: "fact",
          status: "candidate",
          statementStorageRef: "walrus://blob/statement",
          subject: "Project Alpha",
        },
      ],
    });
  });

  it("returns an agent-ready engineering context packet without plaintext statements", async () => {
    const engineeringArtifactId = "33333333-3333-4333-8333-333333333333";
    const db = createFakeDb([], [
      {
        id: "44444444-4444-4444-8444-444444444444",
        twinId,
        sourceArtifactId: engineeringArtifactId,
        memoryFragmentId: "55555555-5555-4555-8555-555555555555",
        memoryType: "decision",
        status: "approved",
        statementStorageRef: "walrus://blob/statement-1",
        statementSha256: "statement-sha-1",
        evidenceHash: "evidence-sha-1",
        evidenceLength: 48,
        confidenceScore: 0.92,
        metadata: {
          engineering: true,
          engineeringMemoryType: "architecture_decision",
          engineeringInstructionScope: "project",
          subject: "Sivraj API",
          sourceType: "github",
          statement: "Plaintext statement must not leave storage.",
          rawText: "Plaintext raw text must not leave storage.",
        },
      },
      {
        id: "66666666-6666-4666-8666-666666666666",
        twinId,
        sourceArtifactId: engineeringArtifactId,
        memoryFragmentId: "77777777-7777-4777-8777-777777777777",
        memoryType: "preference",
        status: "candidate",
        statementStorageRef: "walrus://blob/statement-2",
        statementSha256: "statement-sha-2",
        evidenceHash: "evidence-sha-2",
        evidenceLength: 33,
        confidenceScore: 0.84,
        metadata: {
          engineering: true,
          engineeringMemoryType: "coding_preference",
          engineeringInstructionScope: "global_user",
          subject: "TypeScript",
          sourceType: "agent_instruction_file",
        },
      },
      {
        id: "88888888-8888-4888-8888-888888888888",
        twinId,
        sourceArtifactId: engineeringArtifactId,
        memoryFragmentId: "99999999-9999-4999-8999-999999999999",
        memoryType: "fact",
        status: "candidate",
        statementStorageRef: "walrus://blob/non-engineering",
        statementSha256: "statement-sha-3",
        evidenceHash: "evidence-sha-3",
        evidenceLength: 24,
        confidenceScore: 0.7,
        metadata: {
          subject: "Ignored generic candidate",
        },
      },
    ]);
    const app = createApp({ db });
    const token = await signSessionToken(
      {
        sub: "user-id",
        type: "user",
        scopes: ["memory:read"],
        twinId,
      },
      authConfig,
    );

    const response = await app.request(
      `/v1/twins/${twinId}/engineering/context?artifactId=${engineeringArtifactId}&projectName=Sivraj&includeCandidate=true`,
      {
        headers: { authorization: `Bearer ${token}` },
      },
    );

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body).toMatchObject({
      policy: {
        rawArtifactsIncluded: false,
        decryptedMemoryIncluded: false,
        plaintextStatementsIncluded: false,
        derivedEngineeringContextIncluded: true,
        scope: "memory:read",
      },
      relationship: {
        handoff: expect.stringContaining("contextMarkdown"),
      },
      contextPacket: {
        purpose: "coding_agent_context",
        project: {
          name: "Sivraj",
        },
        counts: {
          totalItems: 2,
          evidenceRefs: 2,
        },
        sections: {
          architectureRules: [
            {
              id: "44444444-4444-4444-8444-444444444444",
              type: "architecture_decision",
              subject: "Sivraj API",
              evidence: {
                candidateMemoryId: "44444444-4444-4444-8444-444444444444",
                sourceArtifactId: engineeringArtifactId,
              },
            },
          ],
          userPreferences: [
            {
              id: "66666666-6666-4666-8666-666666666666",
              type: "coding_preference",
              subject: "TypeScript",
            },
          ],
        },
      },
      profileSummary: {
        totalEngineeringMemories: 2,
        includedContextItems: 2,
      },
    });
    expect(body.contextMarkdown).toContain("# Sivraj Coding Agent Context");
    expect(body.contextMarkdown).toContain("## Apply These Rules");
    expect(body.contextMarkdown).toContain("Respect the user's coding preference around TypeScript.");
    expect(body.contextMarkdown).toContain(`artifact ${engineeringArtifactId}`);
    expect(JSON.stringify(body)).not.toContain("Plaintext statement");
    expect(JSON.stringify(body)).not.toContain("Plaintext raw text");
    expect(JSON.stringify(body)).not.toContain("Ignored generic candidate");
  });

  it("lists stale and conflicting engineering instructions for review", async () => {
    const engineeringArtifactId = "33333333-3333-4333-8333-333333333333";
    const db = createFakeDb([], [
      {
        id: "44444444-4444-4444-8444-444444444444",
        twinId,
        sourceArtifactId: engineeringArtifactId,
        memoryFragmentId: "55555555-5555-4555-8555-555555555555",
        memoryType: "preference",
        status: "candidate",
        statementStorageRef: "walrus://blob/statement-1",
        statementSha256: "statement-sha-1",
        evidenceHash: "evidence-sha-1",
        evidenceLength: 48,
        confidenceScore: 0.92,
        metadata: {
          engineering: true,
          engineeringMemoryType: "tool_preference",
          engineeringInstructionScope: "agent_specific",
          subject: "pnpm",
          agentContextLine: "Use pnpm for package management.",
        },
      },
      {
        id: "66666666-6666-4666-8666-666666666666",
        twinId,
        sourceArtifactId: engineeringArtifactId,
        memoryFragmentId: "77777777-7777-4777-8777-777777777777",
        memoryType: "preference",
        status: "candidate",
        statementStorageRef: "walrus://blob/statement-2",
        statementSha256: "statement-sha-2",
        evidenceHash: "evidence-sha-2",
        evidenceLength: 48,
        confidenceScore: 0.7,
        metadata: {
          engineering: true,
          engineeringMemoryType: "tool_preference",
          engineeringInstructionScope: "agent_specific",
          subject: "npm",
          agentContextLine: "Use npm for package management.",
          statement: "Plaintext statement must not leave storage.",
        },
      },
    ]);
    const app = createApp({ db });
    const token = await signSessionToken(
      {
        sub: "user-id",
        type: "user",
        scopes: ["memory:read"],
        twinId,
      },
      authConfig,
    );

    const response = await app.request(
      `/v1/twins/${twinId}/engineering/review-queue?projectName=Sivraj&repoName=sivraj&packageManager=pnpm&includeTemporary=true`,
      {
        headers: { authorization: `Bearer ${token}` },
      },
    );

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body).toMatchObject({
      policy: {
        rawArtifactsIncluded: false,
        plaintextStatementsIncluded: false,
      },
      summary: {
        issueCount: 1,
      },
      issues: [
        {
          reason: "package_manager_conflict",
          severity: "medium",
          candidate: {
            id: "66666666-6666-4666-8666-666666666666",
            agentContextLine: "Use npm for package management.",
          },
          existing: {
            id: "44444444-4444-4444-8444-444444444444",
            agentContextLine: "Use pnpm for package management.",
          },
        },
      ],
    });
    expect(JSON.stringify(body)).not.toContain("Plaintext statement");
  });

  it("records engineering review actions and updates candidate status", async () => {
    const db = createEngineeringReviewActionDb();
    const app = createApp({ db });
    const token = await signSessionToken(
      {
        sub: "user-id",
        type: "user",
        scopes: ["memory:read"],
        twinId,
      },
      authConfig,
    );

    const response = await app.request(
      `/v1/twins/${twinId}/engineering/review-queue/44444444-4444-4444-8444-444444444444/action`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ action: "supersede" }),
      },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      candidateId: "44444444-4444-4444-8444-444444444444",
      action: "supersede",
      status: "superseded",
      feedbackId: "feedback-id",
    });
    expect(updateValue(db.updateCalls[0])).toMatchObject({ status: "superseded" });
    expect(insertValue(db.insertCalls[0])).toMatchObject({
      feedbackType: "edited_later",
      metadata: {
        surface: "engineering_review_queue",
        action: "supersede",
      },
    });
  });

  it("generates private-safe instruction patch suggestions", async () => {
    const db = createFakeDb([], [
      {
        id: "44444444-4444-4444-8444-444444444444",
        twinId,
        sourceArtifactId: "33333333-3333-4333-8333-333333333333",
        memoryFragmentId: "55555555-5555-4555-8555-555555555555",
        memoryType: "fact",
        status: "approved",
        statementStorageRef: "walrus://blob/statement-1",
        statementSha256: "statement-sha-1",
        evidenceHash: "evidence-sha-1",
        evidenceLength: 48,
        confidenceScore: 0.92,
        metadata: {
          engineering: true,
          engineeringMemoryType: "agent_instruction",
          engineeringInstructionScope: "agent_specific",
          subject: "git safety",
          agentContextLine: "Do not revert user changes unless explicitly requested.",
          statement: "Plaintext statement must not leave storage.",
        },
      },
      {
        id: "66666666-6666-4666-8666-666666666666",
        twinId,
        sourceArtifactId: "33333333-3333-4333-8333-333333333333",
        memoryFragmentId: "77777777-7777-4777-8777-777777777777",
        memoryType: "preference",
        status: "candidate",
        statementStorageRef: "walrus://blob/statement-2",
        statementSha256: "statement-sha-2",
        evidenceHash: "evidence-sha-2",
        evidenceLength: 48,
        confidenceScore: 0.7,
        metadata: {
          engineering: true,
          engineeringMemoryType: "tool_preference",
          engineeringInstructionScope: "agent_specific",
          subject: "pnpm",
          agentContextLine: "Use pnpm for package management.",
        },
      },
    ]);
    const app = createApp({ db });
    const token = await signSessionToken(
      {
        sub: "user-id",
        type: "user",
        scopes: ["memory:read"],
        twinId,
      },
      authConfig,
    );

    const response = await app.request(`/v1/twins/${twinId}/engineering/instruction-patch`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        projectName: "Sivraj",
        repoName: "sivraj",
        packageManager: "pnpm",
        frameworks: ["vite", "react"],
        targetFile: "AGENTS.md",
      }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body).toMatchObject({
      policy: {
        rawArtifactsIncluded: false,
        plaintextStatementsIncluded: false,
        autoWriteEnabled: false,
      },
      patch: {
        targetFile: "AGENTS.md",
        operation: "create_or_replace",
        includedCandidate: false,
        itemCount: 1,
      },
    });
    expect(body.patch.suggestedMarkdown).toContain("# Agent Instructions");
    expect(body.patch.suggestedMarkdown).toContain("Do not revert user changes unless explicitly requested.");
    expect(body.patch.suggestedMarkdown).not.toContain("Use pnpm for package management.");
    expect(JSON.stringify(body)).not.toContain("Plaintext statement");
  });

  it("requires memory read scope for engineering context packets", async () => {
    const db = createFakeDb();
    const app = createApp({ db });
    const token = await signSessionToken(
      {
        sub: "user-id",
        type: "user",
        scopes: ["artifact:upload"],
        twinId,
      },
      authConfig,
    );

    const response = await app.request(`/v1/twins/${twinId}/engineering/context`, {
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: "missing_scope",
      scopes: ["memory:read", AGENT_CONTEXT_READ_SCOPE, AGENT_PROJECT_PROFILE_READ_SCOPE],
    });
  });

  it("returns graph nodes and edges for a twin", async () => {
    const db = createConsoleReadDb();
    const app = createApp({ db });
    const token = await signSessionToken(
      {
        sub: "user-id",
        type: "user",
        scopes: ["memory:read"],
        twinId,
      },
      authConfig,
    );

    const response = await app.request(`/v1/twins/${twinId}/graph`, {
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      nodes: [
        {
          id: "node-id",
          nodeType: "project",
          name: "Project Alpha",
        },
      ],
      edges: [
        {
          id: "edge-id",
          edgeType: "mentions",
        },
      ],
    });
  });
});

describe("Twin identity profile route", () => {
  it("creates identity hints for speaker attribution", async () => {
    const db = createIdentityProfileDb({ profile: null });
    const app = createApp({ db });
    const token = await signSessionToken(
      {
        sub: "user-id",
        type: "user",
        scopes: ["artifact:upload", "memory:read"],
        twinId: "twin-id",
        walletAddress: "0xabc",
      },
      authConfig,
    );

    const response = await app.request("/v1/twins/twin-id/identity-profile", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        displayName: "Fortune Ogunsusi",
        aliases: ["Fortune", "DDBoy", "Fortune"],
        emails: ["ddboy19912@gmail.com"],
        phones: ["+2348169342193"],
        handles: {
          github: ["ddboy19912"],
          slack: ["@fortune"],
        },
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      twinId: "twin-id",
      displayName: "Fortune Ogunsusi",
      aliases: ["Fortune", "DDBoy"],
      emails: ["ddboy19912@gmail.com"],
      phones: ["+2348169342193"],
      handles: {
        github: ["ddboy19912"],
        slack: ["@fortune"],
      },
      selfDescriptionArtifactId: null,
    });
    expect(insertValue(db.insertCalls[0])).toMatchObject({
      twinId: "twin-id",
      displayName: "Fortune Ogunsusi",
      aliases: ["Fortune", "DDBoy"],
    });
    expect(insertValue(db.insertCalls[1])).toMatchObject({
      eventType: "twin_identity_profile.updated",
      resourceType: "twin_identity_profile",
    });
  });

  it("rejects identity profile access for another twin", async () => {
    const app = createApp({ db: createIdentityProfileDb({ profile: null }) });
    const token = await signSessionToken(
      {
        sub: "user-id",
        type: "user",
        scopes: ["artifact:upload", "memory:read"],
        twinId: "other-twin",
      },
      authConfig,
    );

    const response = await app.request("/v1/twins/twin-id/identity-profile", {
      method: "GET",
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "twin_scope_mismatch" });
  });
});

describe("source speaker mapping route", () => {
  it("replaces source-specific speaker mappings for an artifact", async () => {
    const db = createSpeakerMappingDb();
    const app = createApp({ db });
    const token = await signSessionToken(
      {
        sub: "user-id",
        type: "user",
        scopes: ["artifact:upload", "memory:read"],
        twinId: "twin-id",
      },
      authConfig,
    );

    const response = await app.request("/v1/twins/twin-id/artifacts/artifact-id/speaker-mappings", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        mappings: [
          {
            sourceSpeaker: "Fortune",
            role: "self",
            mappedName: "Fortune Ogunsusi",
          },
          {
            sourceSpeaker: "Ada",
            sourceSpeakerId: "U123",
            role: "other",
            mappedName: "Ada Lovelace",
          },
        ],
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      artifactId: "artifact-id",
      detectedSpeakers: ["Fortune", "Ada"],
      mappings: [
        {
          id: "mapping-0",
          sourceSpeaker: "Fortune",
          sourceSpeakerId: null,
          role: "self",
          mappedName: "Fortune Ogunsusi",
          metadata: {},
        },
        {
          id: "mapping-1",
          sourceSpeaker: "Ada",
          sourceSpeakerId: "U123",
          role: "other",
          mappedName: "Ada Lovelace",
          metadata: {},
        },
      ],
    });
    expect(db.deleteCalls).toHaveLength(1);
    expect(insertValue(db.insertCalls[0])).toEqual([
      expect.objectContaining({
        twinId: "twin-id",
        sourceArtifactId: "artifact-id",
        sourceSpeaker: "Fortune",
        role: "self",
      }),
      expect.objectContaining({
        twinId: "twin-id",
        sourceArtifactId: "artifact-id",
        sourceSpeaker: "Ada",
        sourceSpeakerId: "U123",
        role: "other",
      }),
    ]);
    expect(insertValue(db.insertCalls[1])).toMatchObject({
      eventType: "source_speaker_mappings.updated",
      resourceId: "artifact-id",
    });
  });

  it("returns detected speakers and existing mappings", async () => {
    const app = createApp({ db: createSpeakerMappingDb({
      mappings: [
        {
          id: "mapping-id",
          sourceSpeaker: "Fortune",
          sourceSpeakerId: null,
          role: "self",
          mappedName: "Fortune Ogunsusi",
          metadata: {},
        },
      ],
    }) });
    const token = await signSessionToken(
      {
        sub: "user-id",
        type: "user",
        scopes: ["memory:read"],
        twinId: "twin-id",
      },
      authConfig,
    );

    const response = await app.request("/v1/twins/twin-id/artifacts/artifact-id/speaker-mappings", {
      method: "GET",
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      artifactId: "artifact-id",
      detectedSpeakers: ["Fortune", "Ada"],
      mappings: [
        {
          id: "mapping-id",
          sourceSpeaker: "Fortune",
          sourceSpeakerId: null,
          role: "self",
          mappedName: "Fortune Ogunsusi",
          metadata: {},
        },
      ],
    });
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

  it("accepts client-encrypted artifact payloads without requiring plaintext content", async () => {
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

    const encryptedBytes = Buffer.from("client encrypted payload");
    const encryptedSha256 = sha256Hex(encryptedBytes);

    const response = await app.request("/v1/twins/twin-id/artifacts", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        sourceType: "markdown",
        metadata: {
          fileName: "CLAUDE.md",
          fileType: "text/markdown",
          fileSize: 123,
          uploadKind: "file",
          content: "plaintext metadata must be dropped",
        },
        encryptedPayload: {
          ciphertextBase64: encryptedBytes.toString("base64"),
          ciphertextSha256: encryptedSha256,
          seal: {
            packageId: "0xclientpackage",
            policyId: "0xclientpolicy",
            threshold: 1,
            keyServerObjectIds: ["0xclientkeyserver"],
          },
        },
      }),
    });

    expect(response.status).toBe(201);
    expect(privateMemoryStorage.storeCalls).toHaveLength(0);
    expect(privateMemoryStorage.storeEncryptedCalls).toHaveLength(1);
    expect(privateMemoryStorage.storeEncryptedCalls[0]).toMatchObject({
      twinId: "twin-id",
      sourceType: "markdown",
      ciphertextSha256: encryptedSha256,
      seal: {
        packageId: "0xclientpackage",
        policyId: "0xclientpolicy",
        threshold: 1,
        keyServerObjectIds: ["0xclientkeyserver"],
      },
    });
    expect(Buffer.from(privateMemoryStorage.storeEncryptedCalls[0].encryptedBytes).toString("utf8")).toBe(
      "client encrypted payload",
    );
    expect(insertValue(db.insertCalls[0])).toMatchObject({
      metadata: {
        encryptedPayload: {
          encryptionBoundary: "client",
          kind: "source_artifact",
          version: 1,
        },
        fileType: "text/markdown",
        fileSize: 123,
        uploadKind: "file",
      },
      rawStorageRef: "walrus://blob/blob-id",
    });
    expect(JSON.stringify(insertValue(db.insertCalls[0]))).not.toContain("CLAUDE.md");
    expect(artifactProcessingQueue.enqueueCalls[0]).toEqual({
      artifactId: "artifact-id",
      twinId: "twin-id",
      sourceType: "markdown",
    });
    expect(JSON.stringify(db.insertCalls.map(insertValue))).not.toContain("client encrypted payload");
    expect(JSON.stringify(db.insertCalls.map(insertValue))).not.toContain("plaintext metadata");
  });

  it("rejects malformed client-encrypted artifact payloads", async () => {
    const app = createApp({
      db: createFakeDb(),
      privateMemoryStorage: createFakePrivateMemoryStorage(),
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

    const response = await app.request("/v1/twins/twin-id/artifacts", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        sourceType: "note",
        encryptedPayload: {
          ciphertextBase64: "not-valid-base64",
          ciphertextSha256: "bad",
          seal: {
            packageId: "0xclientpackage",
          },
        },
      }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_encrypted_payload" });
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
      jobKey: expect.stringMatching(/^retry-\d+$/),
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
      error: "artifact_not_retryable",
      status: "completed",
      reason: null,
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
      scopes: ["memory:read", AGENT_MEMORY_SEARCH_SCOPE],
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

  it("allows delegated agent memory search scope and audits client identity", async () => {
    const db = createFakeDb([
      memoryRow({
        id: "memory-agent",
        contentStorageRef: "walrus://blob/memory-agent",
      }),
    ]);
    const app = createApp({
      db,
      privateMemoryReader: {
        async readPrivateMemory() {
          return "Sivraj should give coding agents source-backed engineering context.";
        },
      },
    });
    const token = await signSessionToken(
      {
        sub: "agent-client-id",
        type: "agent",
        scopes: [AGENT_MEMORY_SEARCH_SCOPE],
        twinId: "twin-id",
        clientId: "agent-client-id",
      },
      authConfig,
    );

    const response = await app.request("/v1/twins/twin-id/memories/search", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ query: "coding agents context", limit: 5 }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      results: [
        {
          id: "memory-agent",
        },
      ],
      policy: {
        agentScopesAccepted: [AGENT_MEMORY_SEARCH_SCOPE],
      },
    });
    expect(insertValue(db.insertCalls[0])).toMatchObject({
      eventType: "memory.search",
      actorType: "agent",
      actorId: "agent-client-id",
      metadata: {
        clientId: "agent-client-id",
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
            expectedCiphertextSha256: "sha256:encrypted",
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

  it("skips unreadable fragments when other encrypted memories can be searched", async () => {
    const db = createFakeDb([
      memoryRow({
        id: "memory-readable",
        contentStorageRef: "walrus://blob/readable",
      }),
      memoryRow({
        id: "memory-stale",
        contentStorageRef: "walrus://blob/stale",
      }),
    ]);
    const app = createApp({
      db,
      privateMemoryReader: {
        async readPrivateMemory(input) {
          if (input.rawStorageRef === "walrus://blob/stale") {
            throw new Error("walrus_read failed: fetch failed");
          }

          return "I worked with Polytope Labs on Hyperbridge.";
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
      body: JSON.stringify({ query: "Polytope Hyperbridge", limit: 5 }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      results: [
        {
          id: "memory-readable",
          content: "I worked with Polytope Labs on Hyperbridge.",
        },
      ],
      policy: {
        privateFragmentsSkipped: 1,
      },
    });
  });

  it("hides duplicate retrieval rows with the same memory content", async () => {
    const db = createFakeDb([
      memoryRow({
        id: "memory-first",
        contentStorageRef: "walrus://blob/first",
      }),
      memoryRow({
        id: "memory-duplicate",
        contentStorageRef: "walrus://blob/duplicate",
      }),
      memoryRow({
        id: "memory-related",
        contentStorageRef: "walrus://blob/related",
      }),
    ]);
    const app = createApp({
      db,
      privateMemoryReader: {
        async readPrivateMemory(input) {
          if (input.rawStorageRef === "walrus://blob/related") {
            return "I used React and Sui on Hyperbridge bridge infrastructure.";
          }

          return "I worked with Polytope Labs on Hyperbridge.";
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
      body: JSON.stringify({ query: "Polytope Hyperbridge", limit: 5 }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      results: [
        {
          content: "I worked with Polytope Labs on Hyperbridge.",
        },
        {
          content: "I used React and Sui on Hyperbridge bridge infrastructure.",
        },
      ],
      policy: {
        duplicateResultsHidden: 1,
      },
    });
  });

  it("hides semantically duplicated retrieval rows that share a canonical memory", async () => {
    const db = createFakeDb(
      [
        memoryRow({
          id: "memory-original",
          contentStorageRef: "walrus://blob/original",
        }),
        memoryRow({
          id: "memory-paraphrase",
          contentStorageRef: "walrus://blob/paraphrase",
        }),
        memoryRow({
          id: "memory-related",
          contentStorageRef: "walrus://blob/related",
        }),
      ],
      [
        candidateMemoryRow({
          memoryFragmentId: "memory-original",
          canonicalMemoryId: "canonical-polytope-work",
        }),
        candidateMemoryRow({
          memoryFragmentId: "memory-paraphrase",
          canonicalMemoryId: "canonical-polytope-work",
        }),
        candidateMemoryRow({
          memoryFragmentId: "memory-related",
          canonicalMemoryId: "canonical-hyperbridge-tech",
        }),
      ],
    );
    const decryptedRefs: string[] = [];
    const app = createApp({
      db,
      privateMemoryReader: {
        async readPrivateMemory(input) {
          decryptedRefs.push(input.rawStorageRef);

          if (input.rawStorageRef === "walrus://blob/paraphrase") {
            return "At Hyperbridge, I helped Polytope Labs build cross-chain bridge infrastructure.";
          }

          if (input.rawStorageRef === "walrus://blob/related") {
            return "I used React and Sui on Hyperbridge bridge infrastructure.";
          }

          return "I worked with Polytope Labs on Hyperbridge.";
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
      body: JSON.stringify({ query: "Polytope Hyperbridge", limit: 5 }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      results: [
        {
          canonicalMemoryId: "canonical-polytope-work",
        },
        {
          canonicalMemoryId: "canonical-hyperbridge-tech",
        },
      ],
      policy: {
        decryptSkippedCount: 1,
        selectedForDecryptCount: 2,
      },
    });
    expect(decryptedRefs).toEqual([
      "walrus://blob/original",
      "walrus://blob/related",
    ]);
  });

  it("uses configured decrypt evidence limit when searching encrypted memories", async () => {
    const db = createFakeDb([
      memoryRow({
        id: "memory-first",
        contentStorageRef: "walrus://blob/first",
      }),
      memoryRow({
        id: "memory-second",
        contentStorageRef: "walrus://blob/second",
      }),
      memoryRow({
        id: "memory-third",
        contentStorageRef: "walrus://blob/third",
      }),
    ]);
    const decryptedRefs: string[] = [];
    const app = createApp({
      db,
      memorySearchConfig: {
        shortlistLimit: 25,
        fallbackLimit: 20,
        decryptConcurrency: 3,
        decryptEvidenceLimit: 1,
      },
      privateMemoryReader: {
        async readPrivateMemory(input) {
          decryptedRefs.push(input.rawStorageRef);

          return "I worked with Polytope Labs on Hyperbridge.";
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
      body: JSON.stringify({ query: "Polytope Hyperbridge", limit: 5 }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      policy: {
        decryptEvidenceLimit: 1,
        decryptSkippedCount: 2,
        selectedForDecryptCount: 1,
      },
    });
    expect(decryptedRefs).toEqual(["walrus://blob/first"]);
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

function createConsoleReadDb() {
  const artifact = {
    id: "22222222-2222-4222-8222-222222222222",
    twinId: "11111111-1111-4111-8111-111111111111",
    sourceType: "note",
    uri: null,
    rawStorageRef: "walrus://blob/raw",
    hash: "artifact-hash",
    metadata: {
      storageMode: "encrypted_walrus",
      ciphertextSha256: "a".repeat(64),
      processing: {
        reason: "completed",
        intelligence: {
          status: "completed",
          entityExtractionMs: 120,
          memoryExtractionMs: 240,
        },
      },
    },
    ingestionStatus: "completed",
    createdAt: new Date("2026-05-08T00:00:00.000Z"),
    updatedAt: new Date("2026-05-08T00:00:00.000Z"),
  };
  const memoryFragment = {
    id: "fragment-id",
    twinId: artifact.twinId,
    sourceArtifactId: artifact.id,
    contentStorageRef: "walrus://blob/fragment",
    contentSha256: "b".repeat(64),
    metadata: {},
    importanceScore: 0.5,
    confidenceScore: 0.8,
    occurredAt: null,
    createdAt: new Date("2026-05-08T00:00:00.000Z"),
    updatedAt: new Date("2026-05-08T00:00:00.000Z"),
  };
  const candidateMemory = {
    id: "candidate-id",
    twinId: artifact.twinId,
    canonicalMemoryId: "canonical-memory-id",
    sourceArtifactId: artifact.id,
    memoryFragmentId: memoryFragment.id,
    memoryType: "fact",
    status: "candidate",
    statementStorageRef: "walrus://blob/statement",
    statementSha256: "c".repeat(64),
    evidenceHash: "evidence-hash",
    evidenceLength: 42,
    confidenceScore: 0.9,
    metadata: { subject: "Project Alpha" },
    createdAt: new Date("2026-05-08T00:00:00.000Z"),
    updatedAt: new Date("2026-05-08T00:00:00.000Z"),
  };
  const reflection = {
    id: "reflection-id",
    twinId: artifact.twinId,
    periodStart: new Date("2026-05-01T00:00:00.000Z"),
    periodEnd: new Date("2026-05-08T00:00:00.000Z"),
    status: "completed",
    summaryStorageRef: "walrus://blob/reflection",
    summarySha256: "d".repeat(64),
    metadata: {},
    createdAt: new Date("2026-05-08T00:00:00.000Z"),
    updatedAt: new Date("2026-05-08T00:00:00.000Z"),
  };
  const graphNode = {
    id: "node-id",
    twinId: artifact.twinId,
    nodeType: "project",
    name: "Project Alpha",
    normalizedName: "project alpha",
    description: null,
    properties: { sourceType: "note" },
    confidenceScore: 0.8,
    createdAt: new Date("2026-05-08T00:00:00.000Z"),
    updatedAt: new Date("2026-05-08T00:00:00.000Z"),
  };
  const graphEdge = {
    id: "edge-id",
    twinId: artifact.twinId,
    fromNodeId: graphNode.id,
    toNodeId: graphNode.id,
    edgeType: "mentions",
    description: null,
    evidenceMemoryIds: [memoryFragment.id],
    confidenceScore: 0.8,
    createdAt: new Date("2026-05-08T00:00:00.000Z"),
    updatedAt: new Date("2026-05-08T00:00:00.000Z"),
  };

  function rowsForTable(table: unknown) {
    if (table === sourceArtifacts) {
      return [artifact];
    }

    if (table === memoryFragments) {
      return [memoryFragment];
    }

    if (table === candidateMemories) {
      return [candidateMemory];
    }

    if (table === reflectionRuns) {
      return [reflection];
    }

    if (table === graphNodes) {
      return [graphNode];
    }

    if (table === graphEdges) {
      return [graphEdge];
    }

    return [];
  }

  return {
    select(selection?: unknown) {
      const isCountSelect = Boolean(
        selection &&
          typeof selection === "object" &&
          "count" in (selection as Record<string, unknown>),
      );

      return {
        from(table: unknown) {
          return {
            where() {
              const chain = {
                limit() {
                  if (isCountSelect && table === candidateMemories) {
                    return Promise.resolve([{ count: 1 }]);
                  }

                  return Promise.resolve(rowsForTable(table));
                },
                orderBy() {
                  return chain;
                },
                then(resolve: (value: unknown[]) => void) {
                  return chain.limit().then(resolve);
                },
              };

              return chain;
            },
          };
        },
      };
    },
  } as unknown as AppDependencies["db"];
}

function createFakeDb(memoryRows: unknown[] = [], candidateMemoryRows: unknown[] = []) {
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
        from(table: unknown) {
          const rows = table === memoryFragments
            ? memoryRows
            : table === candidateMemories
              ? candidateMemoryRows
              : table === permissionGrants
                ? [{
                    id: "permission-grant-id",
                    scopes: [
                      AGENT_CONTEXT_READ_SCOPE,
                      AGENT_SOURCE_READ_SCOPE,
                      AGENT_PROJECT_PROFILE_READ_SCOPE,
                      AGENT_MEMORY_SEARCH_SCOPE,
                      AGENT_WRITEBACK_CREATE_SCOPE,
                    ],
                  }]
              : [];
          const chain = {
            where() {
              return chain;
            },
            orderBy() {
              return chain;
            },
            limit() {
              return Promise.resolve(rows);
            },
            then(resolve: (value: unknown[]) => void) {
              resolve(rows);
            },
          };

          return chain;
        },
      };
    },
  } as unknown as AppDependencies["db"] & { insertCalls: unknown[] };
}

function createAgentLayerDb(options: { grantScopes?: string[] } = {}) {
  const insertCalls: unknown[] = [];
  const updateCalls: unknown[] = [];
  const grantScopes = options.grantScopes ?? [AGENT_WRITEBACK_CREATE_SCOPE];

  return {
    insertCalls,
    updateCalls,
    insert(table: unknown) {
      return {
        values(value: unknown) {
          insertCalls.push({ table, value });

          return {
            returning() {
              if (table === apiClients) {
                return Promise.resolve([{ id: "agent-client-id" }]);
              }

              if (table === permissionGrants) {
                return Promise.resolve([{ id: "permission-grant-id" }]);
              }

              if (table === agentWritebacks) {
                return Promise.resolve([
                  {
                    id: "agent-writeback-id",
                    twinId: "twin-id",
                    clientId: "agent-client-id",
                    status: "pending",
                    payload: (value as Record<string, unknown>)["payload"],
                    approvedAt: null,
                    rejectedAt: null,
                    createdAt: new Date("2026-05-25T00:00:00.000Z"),
                    updatedAt: new Date("2026-05-25T00:00:00.000Z"),
                  },
                ]);
              }

              if (table === sourceArtifacts) {
                return Promise.resolve([
                  {
                    id: "agent-writeback-artifact-id",
                    ingestionStatus: "queued",
                  },
                ]);
              }

              return Promise.resolve([]);
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
                  if (table === permissionGrants) {
                    return Promise.resolve([
                      {
                        id: "71bdf0a1-8967-41e3-9fe8-caf48b7254ae",
                        twinId: "twin-id",
                        clientId: "agent-client-id",
                        scopes: grantScopes,
                        memoryDomains: ["engineering"],
                        expiresAt: new Date("2026-05-26T00:00:00.000Z"),
                        revokedAt: (value as Record<string, unknown>)["revokedAt"],
                        createdAt: new Date("2026-05-25T00:00:00.000Z"),
                        updatedAt: (value as Record<string, unknown>)["updatedAt"],
                      },
                    ]);
                  }

                  return Promise.resolve([]);
                },
              };
            },
          };
        },
      };
    },
    select() {
      return {
        from(table: unknown) {
          const rows = table === permissionGrants
            ? [{
                id: "permission-grant-id",
                twinId: "twin-id",
                clientId: "agent-client-id",
                scopes: grantScopes,
                memoryDomains: ["engineering"],
                expiresAt: new Date("2026-05-26T00:00:00.000Z"),
                revokedAt: null,
                createdAt: new Date("2026-05-25T00:00:00.000Z"),
                updatedAt: new Date("2026-05-25T00:00:00.000Z"),
              }]
            : table === apiClients
              ? [{
                  id: "agent-client-id",
                  name: "Codex",
                  type: "coding_agent",
                  metadata: { origin: "agent_token_flow" },
                  redirectUris: [],
                  createdAt: new Date("2026-05-25T00:00:00.000Z"),
                  updatedAt: new Date("2026-05-25T00:00:00.000Z"),
                }]
              : [];
          const chain = {
            where() {
              return chain;
            },
            orderBy() {
              return chain;
            },
            limit() {
              return Promise.resolve(rows);
            },
            then(resolve: (value: unknown[]) => void) {
              resolve(rows);
            },
          };

          return chain;
        },
      };
    },
  } as unknown as AppDependencies["db"] & { insertCalls: unknown[]; updateCalls: unknown[] };
}

function createIdentityProfileDb({ profile }: { profile: Record<string, unknown> | null }) {
  const insertCalls: unknown[] = [];
  const updateCalls: unknown[] = [];
  let currentProfile = profile;

  return {
    insertCalls,
    updateCalls,
    insert(table: unknown) {
      return {
        values(value: unknown) {
          insertCalls.push({ table, value });

          return {
            returning() {
              currentProfile = {
                id: "identity-profile-id",
                selfDescriptionArtifactId: null,
                ...(value as Record<string, unknown>),
              };

              return Promise.resolve([currentProfile]);
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
                  currentProfile = {
                    id: currentProfile?.id ?? "identity-profile-id",
                    twinId: currentProfile?.twinId ?? "twin-id",
                    selfDescriptionArtifactId: currentProfile?.selfDescriptionArtifactId ?? null,
                    ...(value as Record<string, unknown>),
                  };

                  return Promise.resolve([currentProfile]);
                },
              };
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
                  return Promise.resolve(currentProfile ? [currentProfile] : []);
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

function createFeedbackDb() {
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
              return Promise.resolve([{ id: "feedback-id" }]);
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
                  return Promise.resolve([{ status: (value as Record<string, unknown>).status }]);
                },
              };
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
                then(resolve: (value: unknown[]) => void) {
                  return Promise.resolve([]).then(resolve);
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

function createEngineeringReviewActionDb() {
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
              if (table === userFeedbackEvents) {
                return Promise.resolve([{ id: "feedback-id" }]);
              }

              return Promise.resolve([{ id: "audit-id" }]);
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
                      id: "44444444-4444-4444-8444-444444444444",
                      status: (value as Record<string, unknown>).status,
                    },
                  ]);
                },
              };
            },
          };
        },
      };
    },
    select() {
      return {
        from(table: unknown) {
          const rows = table === permissionGrants
            ? [{
                id: "permission-grant-id",
                twinId,
                clientId: null,
                scopes: ["memory:read"],
                memoryDomains: ["engineering"],
                expiresAt: new Date("2026-05-26T00:00:00.000Z"),
                revokedAt: null,
              }]
            : [];

          return {
            where() {
              return {
                limit() {
                  return Promise.resolve(rows);
                },
                then(resolve: (value: unknown[]) => void) {
                  return Promise.resolve(rows).then(resolve);
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

function createFakeWeeklyReflectionQueue() {
  const enqueueCalls: Array<{
    reflectionRunId: string;
    twinId: string;
    periodStart: string;
    periodEnd: string;
  }> = [];

  return {
    enqueueCalls,
    async enqueueWeeklyReflection(input: typeof enqueueCalls[number]) {
      enqueueCalls.push(input);
      return { jobId: input.reflectionRunId };
    },
    async close() {},
  };
}

function createConversationReviewDb(input: {
  twinId: string;
  artifactId: string;
  candidateId: string;
}) {
  const insertCalls: unknown[] = [];
  const updateCalls: unknown[] = [];
  const artifact = {
    id: input.artifactId,
    twinId: input.twinId,
    sourceType: "voice_conversation",
    uri: null,
    rawStorageRef: "walrus://blob/voice-conversation",
    hash: null,
    metadata: {
      storageMode: "encrypted_walrus",
      sensitivity: "private",
      fileType: "audio/webm",
      processing: {
        transcription: {
          status: "completed",
        },
      },
    },
    ingestionStatus: "completed",
    createdAt: new Date("2026-05-25T00:00:00.000Z"),
    updatedAt: new Date("2026-05-25T00:00:00.000Z"),
  };
  const candidate = {
    id: input.candidateId,
    twinId: input.twinId,
    canonicalMemoryId: null,
    sourceArtifactId: input.artifactId,
    memoryFragmentId: "44444444-4444-4444-8444-444444444444",
    memoryType: "decision",
    status: "candidate",
    statementStorageRef: "walrus://blob/candidate",
    statementSha256: "sha256:candidate",
    evidenceHash: "evidence-hash",
    evidenceLength: 42,
    confidenceScore: 0.91,
    metadata: {
      sourceKind: "conversation",
      conversationSourceType: "voice_conversation",
      voiceDerived: true,
      subject: "Sivraj positioning",
      conversationUnderstanding: {
        sourceType: "voice_conversation",
        decisionCount: 1,
      },
    },
    createdAt: new Date("2026-05-25T00:01:00.000Z"),
    updatedAt: new Date("2026-05-25T00:01:00.000Z"),
  };

  return {
    insertCalls,
    updateCalls,
    insert(table: unknown) {
      return {
        values(value: unknown) {
          insertCalls.push({ table, value });

          return {
            returning() {
              if (table === userFeedbackEvents) {
                return Promise.resolve([{ id: "feedback-id" }]);
              }

              if (table === sourceArtifacts) {
                return Promise.resolve([
                  {
                    id: "approved-conversation-artifact-id",
                    ingestionStatus: "queued",
                  },
                ]);
              }

              return Promise.resolve([{ id: "audit-id" }]);
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
                  if (table === candidateMemories) {
                    return Promise.resolve([{ status: (value as Record<string, unknown>).status }]);
                  }

                  return Promise.resolve([]);
                },
                then(resolve: (value: unknown[]) => void) {
                  return Promise.resolve([]).then(resolve);
                },
              };
            },
          };
        },
      };
    },
    select() {
      return {
        from(table: unknown) {
          const rows = table === sourceArtifacts
            ? [artifact]
            : table === candidateMemories
              ? [candidate]
              : [];
          const chain = {
            where() {
              return chain;
            },
            orderBy() {
              return chain;
            },
            limit() {
              return Promise.resolve(rows);
            },
            then(resolve: (value: unknown[]) => void) {
              return Promise.resolve(rows).then(resolve);
            },
          };

          return chain;
        },
      };
    },
  } as unknown as AppDependencies["db"] & {
    insertCalls: unknown[];
    updateCalls: unknown[];
  };
}

function createReflectionDb({ existing }: { existing: Record<string, unknown> | null }) {
  const insertCalls: unknown[] = [];
  let current = existing;

  return {
    insertCalls,
    insert(table: unknown) {
      return {
        values(value: unknown) {
          insertCalls.push({ table, value });

          return {
            returning() {
              current = {
                id: "reflection-run-id",
                createdAt: new Date("2026-05-08T00:00:00.000Z"),
                updatedAt: new Date("2026-05-08T00:00:00.000Z"),
                ...(value as Record<string, unknown>),
              };

              return Promise.resolve([{ id: "reflection-run-id" }]);
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
              const rows = current ? [current] : [];

              return {
                orderBy() {
                  return {
                    limit() {
                      return Promise.resolve(rows);
                    },
                  };
                },
                limit() {
                  return Promise.resolve(rows);
                },
              };
            },
          };
        },
      };
    },
    update() {
      return {
        set(value: unknown) {
          current = {
            ...(current ?? {}),
            ...(value as Record<string, unknown>),
          };

          return {
            where() {
              return Promise.resolve([]);
            },
          };
        },
      };
    },
  } as unknown as AppDependencies["db"] & {
    insertCalls: unknown[];
  };
}

function createSpeakerMappingDb({
  artifact = {
    id: "artifact-id",
    twinId: "twin-id",
    metadata: {
      processing: {
        parser: {
          speakers: ["Fortune", "Ada"],
        },
      },
    },
  },
  mappings = [],
}: {
  artifact?: Record<string, unknown> | null;
  mappings?: Record<string, unknown>[];
} = {}) {
  const insertCalls: unknown[] = [];
  const deleteCalls: unknown[] = [];
  let currentMappings = mappings;
  let selectCount = 0;

  return {
    insertCalls,
    deleteCalls,
    insert(table: unknown) {
      return {
        values(value: unknown) {
          insertCalls.push({ table, value });

          return {
            returning() {
              if (Array.isArray(value)) {
                currentMappings = value.map((item, index) => ({
                  id: `mapping-${index}`,
                  ...(item as Record<string, unknown>),
                }));

                return Promise.resolve(currentMappings);
              }

              return Promise.resolve([]);
            },
          };
        },
      };
    },
    delete(table: unknown) {
      return {
        where(value: unknown) {
          deleteCalls.push({ table, value });
          currentMappings = [];
          return Promise.resolve([]);
        },
      };
    },
    select() {
      selectCount += 1;
      return {
        from() {
          return {
            where() {
              const result = selectCount === 1
                ? artifact ? [artifact] : []
                : currentMappings;

              return {
                limit() {
                  return Promise.resolve(result);
                },
                then(resolve: (value: unknown[]) => void) {
                  return Promise.resolve(result).then(resolve);
                },
              };
            },
          };
        },
      };
    },
  } as unknown as AppDependencies["db"] & {
    insertCalls: unknown[];
    deleteCalls: unknown[];
  };
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

function candidateMemoryRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "candidate-memory-id",
    twinId: "twin-id",
    canonicalMemoryId: "canonical-memory-id",
    sourceArtifactId: "artifact-id",
    memoryFragmentId: "memory-id",
    memoryType: "experience",
    status: "candidate",
    statementStorageRef: "walrus://blob/candidate-memory",
    statementSha256: "sha256:candidate",
    evidenceHash: "evidence-hash",
    evidenceLength: 42,
    confidenceScore: 0.8,
    metadata: {
      subject: "Polytope Labs",
    },
    createdAt: new Date("2026-05-18T00:00:00.000Z"),
    updatedAt: new Date("2026-05-18T00:00:00.000Z"),
    ...overrides,
  };
}

function insertValue(call: unknown): Record<string, unknown> {
  return (call as { value: Record<string, unknown> }).value;
}

function updateValue(call: unknown): Record<string, unknown> {
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

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function createFakePrivateMemoryStorage(): AppDependencies["privateMemoryStorage"] & {
  storeCalls: Parameters<NonNullable<AppDependencies["privateMemoryStorage"]>["storePrivateMemory"]>[0][];
  storeEncryptedCalls: Parameters<
    NonNullable<AppDependencies["privateMemoryStorage"]>["storeEncryptedPrivateMemory"]
  >[0][];
} {
  const storeCalls: Parameters<NonNullable<AppDependencies["privateMemoryStorage"]>["storePrivateMemory"]>[0][] = [];
  const storeEncryptedCalls: Parameters<
    NonNullable<AppDependencies["privateMemoryStorage"]>["storeEncryptedPrivateMemory"]
  >[0][] = [];

  const stored = {
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

  return {
    storeCalls,
    storeEncryptedCalls,
    async storePrivateMemory(input) {
      storeCalls.push(input);

      return stored;
    },
    async storeEncryptedPrivateMemory(input) {
      storeEncryptedCalls.push(input);

      return stored;
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
