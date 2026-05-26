import {
  AGENT_CONTEXT_READ_SCOPE,
  AGENT_MEMORY_SEARCH_SCOPE,
  AGENT_PROJECT_PROFILE_READ_SCOPE,
  AGENT_SCOPES,
  AGENT_SOURCE_READ_SCOPE,
  AGENT_WRITEBACK_CREATE_SCOPE,
  loadAuthConfig,
  signSessionToken,
  type AgentScope,
} from "@sivraj/auth";
import {
  DEFAULT_MANUAL_MEMORY_SENSITIVITY,
  ENCRYPTED_WALRUS_STORAGE_MODE,
} from "@sivraj/core";
import { agentWritebacks, apiClients, auditEvents, permissionGrants, sourceArtifacts } from "@sivraj/db";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import { createHash } from "node:crypto";
import type { Context } from "hono";
import { Hono } from "hono";
import type { AppDependencies } from "../app.js";
import { hasActiveAgentGrantForScopes } from "../lib/agent-grants.js";
import { requireAnyScope, requireAuth, requireScope, type AuthEnv } from "../middleware/auth.js";

const DEFAULT_AGENT_TOKEN_TTL_MINUTES = 24 * 60;
const MAX_AGENT_TOKEN_TTL_MINUTES = 30 * 24 * 60;
const DEFAULT_AGENT_SCOPES: AgentScope[] = [
  AGENT_CONTEXT_READ_SCOPE,
  AGENT_SOURCE_READ_SCOPE,
  AGENT_PROJECT_PROFILE_READ_SCOPE,
  AGENT_MEMORY_SEARCH_SCOPE,
  AGENT_WRITEBACK_CREATE_SCOPE,
];

export function createAgentTokenRoutes({
  db,
  privateMemoryStorage,
  artifactProcessingQueue,
  transientCiphertextCache,
}: AppDependencies) {
  const routes = new Hono<AuthEnv>();

  routes.post("/tokens", requireAuth, async (c) => {
    const scopeError = requireScope(c, "memory:read");
    if (scopeError) {
      return scopeError;
    }

    const auth = c.get("auth");
    const twinId = c.req.param("twinId");
    if (!twinId) {
      return c.json({ error: "missing_twin_id" }, 400);
    }

    if (auth.type !== "service" && auth.twinId !== twinId) {
      return c.json({ error: "twin_scope_mismatch" }, 403);
    }

    if (auth.type !== "user" && auth.type !== "service") {
      return c.json({ error: "agent_tokens_require_user_or_service_actor" }, 403);
    }

    const body = await c.req.json().catch(() => ({}));
    const agentName = optionalString(body["agentName"]) ?? "Coding Agent";
    const requestedScopes = readAgentScopes(body["scopes"]);
    const scopes = requestedScopes.length > 0 ? requestedScopes : DEFAULT_AGENT_SCOPES;
    const expiresInMinutes = clampTtl(body["expiresInMinutes"]);
    const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000);
    const authConfig = readAuthConfig();

    if (!authConfig) {
      return c.json({ error: "auth_not_configured" }, 503);
    }

    const [client] = await db
      .insert(apiClients)
      .values({
        name: agentName,
        type: "coding_agent",
        metadata: {
          createdBy: auth.sub,
          createdByType: auth.type,
          origin: "agent_token_flow",
          userAgent: c.req.header("user-agent") ?? null,
        },
      })
      .returning();

    const [grant] = await db
      .insert(permissionGrants)
      .values({
        twinId,
        clientId: client.id,
        scopes,
        memoryDomains: ["engineering"],
        expiresAt,
      })
      .returning();

    const token = await signSessionToken(
      {
        sub: client.id,
        type: "agent",
        scopes,
        twinId,
        clientId: client.id,
      },
      authConfig,
      `${expiresInMinutes}m`,
    );

    await db.insert(auditEvents).values({
      twinId,
      actorType: auth.type,
      actorId: auth.sub,
      eventType: "agent_token.created",
      resourceType: "api_client",
      resourceId: client.id,
      metadata: {
        clientId: client.id,
        grantId: grant.id,
        agentName,
        scopes,
        expiresAt: expiresAt.toISOString(),
      },
    });

    return c.json(
      {
        token,
        tokenType: "Bearer",
        subjectType: "agent",
        clientId: client.id,
        grantId: grant.id,
        twinId,
        scopes,
        expiresAt: expiresAt.toISOString(),
      },
      201,
    );
  });

  routes.get("/clients", requireAuth, async (c) => {
    const scopeError = requireScope(c, "memory:read");
    if (scopeError) {
      return scopeError;
    }

    const auth = c.get("auth");
    const twinId = c.req.param("twinId");
    if (!twinId) {
      return c.json({ error: "missing_twin_id" }, 400);
    }

    if (auth.type !== "service" && auth.twinId !== twinId) {
      return c.json({ error: "twin_scope_mismatch" }, 403);
    }

    const grants = await db
      .select()
      .from(permissionGrants)
      .where(eq(permissionGrants.twinId, twinId))
      .orderBy(desc(permissionGrants.createdAt))
      .limit(100);
    const clientIds = Array.from(new Set(grants.map((grant) => grant.clientId)));
    const clients = clientIds.length > 0
      ? await db.select().from(apiClients).where(inArray(apiClients.id, clientIds))
      : [];
    const clientsById = new Map(clients.map((client) => [client.id, client]));

    await db.insert(auditEvents).values({
      twinId,
      actorType: auth.type,
      actorId: auth.sub,
      eventType: "agent_clients.listed",
      resourceType: "twin",
      resourceId: twinId,
      metadata: {
        clientCount: clients.length,
        grantCount: grants.length,
      },
    });

    return c.json({
      policy: {
        rawArtifactsIncluded: false,
        scope: "memory:read",
      },
      clients: grants.map((grant) => {
        const client = clientsById.get(grant.clientId);
        return {
          clientId: grant.clientId,
          grantId: grant.id,
          name: client?.name ?? "Unknown agent",
          type: client?.type ?? "unknown",
          scopes: grant.scopes,
          memoryDomains: grant.memoryDomains,
          expiresAt: grant.expiresAt?.toISOString() ?? null,
          revokedAt: grant.revokedAt?.toISOString() ?? null,
          createdAt: grant.createdAt.toISOString(),
          updatedAt: grant.updatedAt.toISOString(),
          status: readGrantStatus(grant.revokedAt, grant.expiresAt),
          metadata: sanitizeAgentClientMetadata(client?.metadata),
        };
      }),
    });
  });

  routes.post("/clients/:grantId/revoke", requireAuth, async (c) => {
    const scopeError = requireScope(c, "memory:read");
    if (scopeError) {
      return scopeError;
    }

    const auth = c.get("auth");
    const twinId = c.req.param("twinId");
    const grantOrClientId = readUuid(c.req.param("grantId"));
    if (!twinId) {
      return c.json({ error: "missing_twin_id" }, 400);
    }

    if (!grantOrClientId) {
      return c.json({ error: "invalid_grant_or_client_id" }, 400);
    }

    if (auth.type !== "service" && auth.twinId !== twinId) {
      return c.json({ error: "twin_scope_mismatch" }, 403);
    }

    const now = new Date();
    const [grant] = await db
      .update(permissionGrants)
      .set({
        revokedAt: now,
        updatedAt: now,
      })
      .where(and(
        eq(permissionGrants.twinId, twinId),
        or(
          eq(permissionGrants.id, grantOrClientId),
          eq(permissionGrants.clientId, grantOrClientId),
        ),
      ))
      .returning();

    if (!grant) {
      return c.json({ error: "agent_grant_not_found" }, 404);
    }

    await db.insert(auditEvents).values({
      twinId,
      actorType: auth.type,
      actorId: auth.sub,
      eventType: "agent_client.revoked",
      resourceType: "permission_grant",
      resourceId: grant.id,
      metadata: {
        clientId: grant.clientId,
        scopes: grant.scopes,
      },
    });

    return c.json({
      grantId: grant.id,
      clientId: grant.clientId,
      revokedAt: now.toISOString(),
      status: "revoked",
    });
  });

  routes.post("/writebacks", requireAuth, async (c) => {
    const scopeError = requireAnyScope(c, [AGENT_WRITEBACK_CREATE_SCOPE, "artifact:upload"]);
    if (scopeError) {
      return scopeError;
    }

    const auth = c.get("auth");
    const twinId = c.req.param("twinId");
    if (!twinId) {
      return c.json({ error: "missing_twin_id" }, 400);
    }

    if (auth.type !== "service" && auth.twinId !== twinId) {
      return c.json({ error: "twin_scope_mismatch" }, 403);
    }

    if (!await hasActiveAgentGrantForScopes({
      db,
      auth,
      twinId,
      acceptedScopes: [AGENT_WRITEBACK_CREATE_SCOPE],
    })) {
      return c.json({ error: "agent_grant_inactive" }, 403);
    }

    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return c.json({ error: "invalid_json_body" }, 400);
    }

    const encryptedPayload = (() => {
      try {
        return readEncryptedPayload(body["encryptedPayload"]);
      } catch {
        return "invalid" as const;
      }
    })();

    if (encryptedPayload === "invalid") {
      return c.json({ error: "invalid_encrypted_payload" }, 400);
    }

    const taskSummary = requiredString(body["taskSummary"]);
    const taskSummarySha256 = optionalSha256(body["taskSummarySha256"]);
    if (!taskSummary && !encryptedPayload) {
      return c.json({ error: "missing_task_summary" }, 400);
    }

    if (body["taskSummarySha256"] !== undefined && !taskSummarySha256) {
      return c.json({ error: "invalid_task_summary_sha256" }, 400);
    }

    if (!privateMemoryStorage) {
      return c.json({ error: "encrypted_storage_not_configured" }, 503);
    }

    if (!auth.clientId) {
      return c.json({ error: "agent_client_required" }, 403);
    }

    const agentName = optionalString(body["agentName"]) ?? "coding-agent";
    const safeCounts = readCountRecord(body["counts"]);
    const writebackPayload = {
      agentName,
      repo: optionalString(body["repo"]),
      branch: optionalString(body["branch"]),
      taskSummary: taskSummary ?? "[client-encrypted writeback]",
      filesTouched: readStringArray(body["filesTouched"]),
      commandsRun: readStringArray(body["commandsRun"]),
      testsRun: readStringArray(body["testsRun"]),
      decisions: readStringArray(body["decisions"]),
      bugsFound: readStringArray(body["bugsFound"]),
      followUps: readStringArray(body["followUps"]),
      userCorrections: readStringArray(body["userCorrections"]),
    };
    const content = formatAgentWriteback(writebackPayload);
    const metadata = {
      uploadKind: "agent_writeback",
      importer: "sivraj_agent_api",
      agentName,
      repo: writebackPayload.repo ?? null,
      branch: writebackPayload.branch ?? null,
      clientId: auth.clientId ?? null,
      storageMode: ENCRYPTED_WALRUS_STORAGE_MODE,
      sensitivity: DEFAULT_MANUAL_MEMORY_SENSITIVITY,
      encryptionBoundary: encryptedPayload ? "client" : "api",
    };
    const stored = await (encryptedPayload
      ? privateMemoryStorage.storeEncryptedPrivateMemory({
          twinId,
          sourceType: "note",
          encryptedBytes: encryptedPayload.encryptedBytes,
          ciphertextSha256: encryptedPayload.ciphertextSha256,
          seal: encryptedPayload.seal,
        })
      : privateMemoryStorage.storePrivateMemory({
          twinId,
          sourceType: "note",
          title: `Coding agent writeback: ${agentName}`,
          content,
          metadata,
        })
    ).catch((error: unknown) => {
      console.error("agent writeback encrypted storage failed", error);
      return null;
    });

    if (!stored) {
      return c.json({ error: "encrypted_storage_failed" }, 503);
    }

    const [writeback] = await db
      .insert(agentWritebacks)
      .values({
        twinId,
        clientId: auth.clientId,
        status: "pending",
        payload: {
          kind: "coding_agent_writeback",
          agentName,
          repo: metadata.repo,
          branch: metadata.branch,
          summarySha256: taskSummarySha256 ?? sha256Hex(taskSummary ?? ""),
          counts: {
            filesTouched: encryptedPayload ? safeCounts.filesTouched : writebackPayload.filesTouched.length,
            commandsRun: encryptedPayload ? safeCounts.commandsRun : writebackPayload.commandsRun.length,
            testsRun: encryptedPayload ? safeCounts.testsRun : writebackPayload.testsRun.length,
            decisions: encryptedPayload ? safeCounts.decisions : writebackPayload.decisions.length,
            bugsFound: encryptedPayload ? safeCounts.bugsFound : writebackPayload.bugsFound.length,
            followUps: encryptedPayload ? safeCounts.followUps : writebackPayload.followUps.length,
            userCorrections: encryptedPayload ? safeCounts.userCorrections : writebackPayload.userCorrections.length,
          },
          storage: {
            rawStorageRef: stored.rawStorageRef,
            ciphertextSha256: stored.ciphertextSha256,
            seal: stored.seal,
            walrus: stored.walrus,
            storageMode: ENCRYPTED_WALRUS_STORAGE_MODE,
            sensitivity: DEFAULT_MANUAL_MEMORY_SENSITIVITY,
            encryptionBoundary: encryptedPayload ? "client" : "api",
          },
          artifactMetadata: metadata,
        },
      })
      .returning();

    if (stored.encryptedBytesBase64) {
      await transientCiphertextCache?.putArtifactCiphertext({
        artifactId: writeback.id,
        ciphertextBase64: stored.encryptedBytesBase64,
        ciphertextSha256: stored.ciphertextSha256,
      }).catch((error: unknown) => {
        console.warn("agent writeback transient ciphertext cache failed", {
          writebackId: writeback.id,
          error: errorMessage(error),
        });
      });
    }

    await db.insert(auditEvents).values({
      twinId,
      actorType: auth.type,
      actorId: auth.sub,
      eventType: "agent.writeback.created",
      resourceType: "agent_writeback",
      resourceId: writeback.id,
      metadata: {
        clientId: auth.clientId,
        agentName,
        rawStorageRef: stored.rawStorageRef,
        storageMode: ENCRYPTED_WALRUS_STORAGE_MODE,
        encryptionBoundary: encryptedPayload ? "client" : "api",
        status: "pending",
      },
    });

    return c.json(
      {
        writebackId: writeback.id,
        status: writeback.status,
        storageMode: ENCRYPTED_WALRUS_STORAGE_MODE,
        rawStorageRef: stored.rawStorageRef,
        warning: "agent_writeback_pending_review",
      },
      201,
    );
  });

  routes.post("/writebacks/imports/pr", requireAuth, async (c) => {
    const result = await createPrOrCommitWritebackImport(c, {
      db,
      privateMemoryStorage,
      transientCiphertextCache,
      kind: "pull_request",
    });

    return result;
  });

  routes.post("/writebacks/imports/commit", requireAuth, async (c) => {
    const result = await createPrOrCommitWritebackImport(c, {
      db,
      privateMemoryStorage,
      transientCiphertextCache,
      kind: "commit",
    });

    return result;
  });

  routes.get("/writebacks", requireAuth, async (c) => {
    const scopeError = requireScope(c, "memory:read");
    if (scopeError) {
      return scopeError;
    }

    const auth = c.get("auth");
    const twinId = c.req.param("twinId");
    if (!twinId) {
      return c.json({ error: "missing_twin_id" }, 400);
    }

    if (auth.type !== "service" && auth.twinId !== twinId) {
      return c.json({ error: "twin_scope_mismatch" }, 403);
    }

    const status = readWritebackStatus(c.req.query("status"));
    const limit = readLimit(c.req.query("limit"));
    const filters = [eq(agentWritebacks.twinId, twinId)];
    if (status) {
      filters.push(eq(agentWritebacks.status, status));
    }

    const rows = await db
      .select()
      .from(agentWritebacks)
      .where(and(...filters))
      .orderBy(desc(agentWritebacks.createdAt))
      .limit(limit);

    await db.insert(auditEvents).values({
      twinId,
      actorType: auth.type,
      actorId: auth.sub,
      eventType: "agent.writebacks.listed",
      resourceType: "twin",
      resourceId: twinId,
      metadata: {
        status,
        writebackCount: rows.length,
        limit,
      },
    });

    return c.json({
      policy: {
        rawArtifactsIncluded: false,
        decryptedWritebackIncluded: false,
        scope: "memory:read",
      },
      writebacks: rows.map(toAgentWritebackSummary),
    });
  });

  routes.post("/writebacks/:writebackId/approve", requireAuth, async (c) => {
    const scopeError = requireScope(c, "memory:read");
    if (scopeError) {
      return scopeError;
    }

    const auth = c.get("auth");
    const twinId = c.req.param("twinId");
    const writebackId = readUuid(c.req.param("writebackId"));
    if (!twinId) {
      return c.json({ error: "missing_twin_id" }, 400);
    }

    if (!writebackId) {
      return c.json({ error: "invalid_writeback_id" }, 400);
    }

    if (auth.type !== "service" && auth.twinId !== twinId) {
      return c.json({ error: "twin_scope_mismatch" }, 403);
    }

    const [existing] = await db
      .select()
      .from(agentWritebacks)
      .where(and(
        eq(agentWritebacks.id, writebackId),
        eq(agentWritebacks.twinId, twinId),
      ))
      .limit(1);

    if (!existing) {
      return c.json({ error: "agent_writeback_not_found" }, 404);
    }

    if (existing.status !== "pending") {
      return c.json({ error: "agent_writeback_not_pending" }, 409);
    }

    const payload = record(existing.payload);
    const storage = record(payload["storage"]);
    const artifactMetadata = record(payload["artifactMetadata"]);
    const rawStorageRef = optionalString(storage["rawStorageRef"]);
    const ciphertextSha256 = optionalString(storage["ciphertextSha256"]);
    if (!rawStorageRef || !ciphertextSha256) {
      return c.json({ error: "agent_writeback_storage_missing" }, 409);
    }

    const [artifact] = await db
      .insert(sourceArtifacts)
      .values({
        twinId,
        sourceType: "note",
        metadata: {
          ...artifactMetadata,
          ciphertextSha256,
          seal: storage["seal"] ?? null,
          walrus: storage["walrus"] ?? null,
          agentWritebackId: existing.id,
        },
        rawStorageRef,
        ingestionStatus: "queued",
      })
      .returning();

    const transient = await transientCiphertextCache
      ?.getArtifactCiphertext(existing.id)
      .catch((error: unknown) => {
        console.warn("agent writeback transient ciphertext lookup failed", {
          writebackId: existing.id,
          error: errorMessage(error),
        });
        return null;
      }) ?? null;

    if (transient) {
      await transientCiphertextCache?.putArtifactCiphertext({
        artifactId: artifact.id,
        ciphertextBase64: transient.ciphertextBase64,
        ciphertextSha256: transient.ciphertextSha256,
      }).catch((error: unknown) => {
        console.warn("approved writeback transient ciphertext cache failed", {
          artifactId: artifact.id,
          writebackId: existing.id,
          error: errorMessage(error),
        });
      });
    }

    const queued = artifactProcessingQueue
      ? await artifactProcessingQueue.enqueueArtifactProcessing({
          artifactId: artifact.id,
          twinId,
          sourceType: "note",
          jobKey: "approval",
          ...(transient
            ? {
                transientCiphertextBase64: transient.ciphertextBase64,
                transientCiphertextSha256: transient.ciphertextSha256,
              }
            : {}),
        }).catch(async (error: unknown) => {
          console.error("agent writeback queue enqueue failed", error);
          await db.insert(auditEvents).values({
            twinId,
            actorType: "system",
            actorId: "sivraj-api",
            eventType: "agent.writeback_queue_failed",
            resourceType: "source_artifact",
            resourceId: artifact.id,
            metadata: {
              clientId: existing.clientId,
              error: errorMessage(error),
            },
          });
          return null;
        })
      : null;

    const now = new Date();
    const [updated] = await db
      .update(agentWritebacks)
      .set({
        status: "approved",
        approvedAt: now,
        updatedAt: now,
        payload: {
          ...payload,
          approvedArtifactId: artifact.id,
          approvedAt: now.toISOString(),
        },
      })
      .where(and(
        eq(agentWritebacks.id, existing.id),
        eq(agentWritebacks.twinId, twinId),
      ))
      .returning();

    await db.insert(auditEvents).values({
      twinId,
      actorType: auth.type,
      actorId: auth.sub,
      eventType: "agent.writeback.approved",
      resourceType: "agent_writeback",
      resourceId: existing.id,
      metadata: {
        clientId: existing.clientId,
        artifactId: artifact.id,
        processingJobId: queued?.jobId ?? null,
      },
    });

    return c.json({
      writebackId: updated?.id ?? existing.id,
      artifactId: artifact.id,
      status: artifact.ingestionStatus,
      storageMode: ENCRYPTED_WALRUS_STORAGE_MODE,
      rawStorageRef,
      processingJobId: queued?.jobId ?? null,
      warning: artifactProcessingQueue ? (queued ? null : "artifact_processing_queue_failed") : "artifact_processing_queue_not_configured",
    });
  });

  routes.post("/writebacks/:writebackId/reject", requireAuth, async (c) => {
    const scopeError = requireScope(c, "memory:read");
    if (scopeError) {
      return scopeError;
    }

    const auth = c.get("auth");
    const twinId = c.req.param("twinId");
    const writebackId = readUuid(c.req.param("writebackId"));
    if (!twinId) {
      return c.json({ error: "missing_twin_id" }, 400);
    }

    if (!writebackId) {
      return c.json({ error: "invalid_writeback_id" }, 400);
    }

    if (auth.type !== "service" && auth.twinId !== twinId) {
      return c.json({ error: "twin_scope_mismatch" }, 403);
    }

    const now = new Date();
    const [writeback] = await db
      .update(agentWritebacks)
      .set({
        status: "rejected",
        rejectedAt: now,
        updatedAt: now,
      })
      .where(and(
        eq(agentWritebacks.id, writebackId),
        eq(agentWritebacks.twinId, twinId),
      ))
      .returning();

    if (!writeback) {
      return c.json({ error: "agent_writeback_not_found" }, 404);
    }

    await db.insert(auditEvents).values({
      twinId,
      actorType: auth.type,
      actorId: auth.sub,
      eventType: "agent.writeback.rejected",
      resourceType: "agent_writeback",
      resourceId: writeback.id,
      metadata: {
        clientId: writeback.clientId,
      },
    });

    return c.json({
      writebackId: writeback.id,
      status: writeback.status,
      rejectedAt: writeback.rejectedAt?.toISOString() ?? now.toISOString(),
    });
  });

  return routes;
}

async function createPrOrCommitWritebackImport(
  c: Context<AuthEnv>,
  input: {
    db: AppDependencies["db"];
    privateMemoryStorage: AppDependencies["privateMemoryStorage"];
    transientCiphertextCache: AppDependencies["transientCiphertextCache"];
    kind: "pull_request" | "commit";
  },
): Promise<Response> {
  const scopeError = requireAnyScope(c, [AGENT_WRITEBACK_CREATE_SCOPE, "artifact:upload"]);
  if (scopeError) {
    return scopeError;
  }

  const auth = c.get("auth");
  const twinId = c.req.param("twinId");
  if (!twinId) {
    return c.json({ error: "missing_twin_id" }, 400);
  }

  if (auth.type !== "service" && auth.twinId !== twinId) {
    return c.json({ error: "twin_scope_mismatch" }, 403);
  }

  if (!await hasActiveAgentGrantForScopes({
    db: input.db,
    auth,
    twinId,
    acceptedScopes: [AGENT_WRITEBACK_CREATE_SCOPE],
  })) {
    return c.json({ error: "agent_grant_inactive" }, 403);
  }

  if (!input.privateMemoryStorage) {
    return c.json({ error: "encrypted_storage_not_configured" }, 503);
  }

  if (!auth.clientId) {
    return c.json({ error: "agent_client_required" }, 403);
  }

  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return c.json({ error: "invalid_json_body" }, 400);
  }

  const payload = body as Record<string, unknown>;
  const agentName = optionalString(payload["agentName"]) ?? "coding-agent";
  const repo = optionalString(payload["repo"]);
  const title = requiredString(payload["title"]);
  const url = optionalString(payload["url"]);
  const author = optionalString(payload["author"]);
  const mergedAt = optionalString(payload["mergedAt"]);
  const committedAt = optionalString(payload["committedAt"]);
  const identifier = optionalString(payload["number"]) ?? optionalString(payload["sha"]) ?? optionalString(payload["id"]);
  const summary = requiredString(payload["summary"]) ?? requiredString(payload["body"]);
  const filesChanged = readStringArray(payload["filesChanged"]);
  const commandsRun = readStringArray(payload["commandsRun"]);
  const testsRun = readStringArray(payload["testsRun"]);
  const decisions = readStringArray(payload["decisions"]);
  const bugsFixed = readStringArray(payload["bugsFixed"]);
  const reviewComments = readStringArray(payload["reviewComments"]);
  const userCorrections = readStringArray(payload["userCorrections"]);

  if (!title || !summary) {
    return c.json({
      error: input.kind === "pull_request" ? "missing_pr_title_or_summary" : "missing_commit_title_or_summary",
    }, 400);
  }

  const content = formatPrOrCommitImportWriteback({
    kind: input.kind,
    agentName,
    repo,
    identifier,
    title,
    url,
    author,
    mergedAt,
    committedAt,
    summary,
    filesChanged,
    commandsRun,
    testsRun,
    decisions,
    bugsFixed,
    reviewComments,
    userCorrections,
  });
  const metadata = {
    uploadKind: "agent_writeback",
    importer: "sivraj_agent_api",
    writebackKind: input.kind === "pull_request" ? "pr_import" : "commit_import",
    agentName,
    repo: repo ?? null,
    clientId: auth.clientId,
    storageMode: ENCRYPTED_WALRUS_STORAGE_MODE,
    sensitivity: DEFAULT_MANUAL_MEMORY_SENSITIVITY,
  };
  const stored = await input.privateMemoryStorage.storePrivateMemory({
    twinId,
    sourceType: "note",
    title: input.kind === "pull_request"
      ? `PR writeback import: ${title}`
      : `Commit writeback import: ${title}`,
    content,
    metadata,
  }).catch((error: unknown) => {
    console.error("agent writeback import encrypted storage failed", error);
    return null;
  });

  if (!stored) {
    return c.json({ error: "encrypted_storage_failed" }, 503);
  }

  const [writeback] = await input.db
    .insert(agentWritebacks)
    .values({
      twinId,
      clientId: auth.clientId,
      status: "pending",
      payload: {
        kind: input.kind === "pull_request" ? "coding_agent_pr_import" : "coding_agent_commit_import",
        agentName,
        repo: repo ?? null,
        identifier: identifier ?? null,
        titleSha256: sha256Hex(title),
        summarySha256: sha256Hex(summary),
        counts: {
          filesChanged: filesChanged.length,
          commandsRun: commandsRun.length,
          testsRun: testsRun.length,
          decisions: decisions.length,
          bugsFixed: bugsFixed.length,
          reviewComments: reviewComments.length,
          userCorrections: userCorrections.length,
        },
        storage: {
          rawStorageRef: stored.rawStorageRef,
          ciphertextSha256: stored.ciphertextSha256,
          seal: stored.seal,
          walrus: stored.walrus,
          storageMode: ENCRYPTED_WALRUS_STORAGE_MODE,
          sensitivity: DEFAULT_MANUAL_MEMORY_SENSITIVITY,
        },
        artifactMetadata: metadata,
      },
    })
    .returning();

  if (stored.encryptedBytesBase64) {
    await input.transientCiphertextCache?.putArtifactCiphertext({
      artifactId: writeback.id,
      ciphertextBase64: stored.encryptedBytesBase64,
      ciphertextSha256: stored.ciphertextSha256,
    }).catch((error: unknown) => {
      console.warn("agent writeback import transient ciphertext cache failed", {
        writebackId: writeback.id,
        error: errorMessage(error),
      });
    });
  }

  await input.db.insert(auditEvents).values({
    twinId,
    actorType: auth.type,
    actorId: auth.sub,
    eventType: input.kind === "pull_request" ? "agent.writeback_pr_import.created" : "agent.writeback_commit_import.created",
    resourceType: "agent_writeback",
    resourceId: writeback.id,
    metadata: {
      clientId: auth.clientId,
      agentName,
      repo: repo ?? null,
      identifier: identifier ?? null,
      rawStorageRef: stored.rawStorageRef,
      storageMode: ENCRYPTED_WALRUS_STORAGE_MODE,
      status: "pending",
    },
  });

  return c.json(
    {
      writebackId: writeback.id,
      kind: input.kind,
      status: writeback.status,
      storageMode: ENCRYPTED_WALRUS_STORAGE_MODE,
      rawStorageRef: stored.rawStorageRef,
      warning: "agent_writeback_pending_review",
    },
    201,
  );
}

function readAgentScopes(value: unknown): AgentScope[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(new Set(value.filter(isAgentScope)));
}

function isAgentScope(value: unknown): value is AgentScope {
  return typeof value === "string" && (AGENT_SCOPES as readonly string[]).includes(value);
}

function clampTtl(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return DEFAULT_AGENT_TOKEN_TTL_MINUTES;
  }

  return Math.min(parsed, MAX_AGENT_TOKEN_TTL_MINUTES);
}

function optionalString(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readUuid(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trimmed)
    ? trimmed
    : null;
}

function readWritebackStatus(value: unknown): "pending" | "approved" | "rejected" | "expired" | "superseded" | null {
  return value === "pending" ||
    value === "approved" ||
    value === "rejected" ||
    value === "expired" ||
    value === "superseded"
    ? value
    : null;
}

function readLimit(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);

  return Number.isInteger(parsed) && parsed > 0
    ? Math.min(parsed, 500)
    : 100;
}

function readGrantStatus(revokedAt: Date | null, expiresAt: Date | null): "active" | "revoked" | "expired" {
  if (revokedAt) {
    return "revoked";
  }

  if (expiresAt && expiresAt.getTime() <= Date.now()) {
    return "expired";
  }

  return "active";
}

function sanitizeAgentClientMetadata(value: unknown): Record<string, unknown> {
  const metadata = record(value);
  return {
    origin: optionalString(metadata["origin"]) ?? null,
    createdByType: optionalString(metadata["createdByType"]) ?? null,
  };
}

function requiredString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readEncryptedPayload(value: unknown): {
  encryptedBytes: Uint8Array;
  ciphertextSha256: string;
  seal: {
    packageId: string;
    policyId: string;
    threshold: number;
    keyServerObjectIds: string[];
  };
} | null {
  const payload = record(value);
  const ciphertextBase64 = requiredString(payload["ciphertextBase64"]);
  const ciphertextSha256 = optionalSha256(payload["ciphertextSha256"]);
  const seal = record(payload["seal"]);
  const packageId = requiredString(seal["packageId"]);
  const policyId = requiredString(seal["policyId"]);
  const threshold = typeof seal["threshold"] === "number" ? seal["threshold"] : null;
  const keyServerObjectIds = Array.isArray(seal["keyServerObjectIds"])
    ? seal["keyServerObjectIds"].filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];

  if (!ciphertextBase64 && !ciphertextSha256 && Object.keys(seal).length === 0) {
    return null;
  }

  if (!ciphertextBase64 || !ciphertextSha256 || !packageId || !policyId || !threshold || keyServerObjectIds.length === 0) {
    throw new Error("invalid_encrypted_payload");
  }

  if (!Number.isInteger(threshold) || threshold < 1 || threshold > keyServerObjectIds.length) {
    throw new Error("invalid_encrypted_payload");
  }

  const encryptedBytes = Buffer.from(ciphertextBase64, "base64");

  if (encryptedBytes.length === 0 || encryptedBytes.toString("base64") !== ciphertextBase64) {
    throw new Error("invalid_encrypted_payload");
  }

  const actualSha256 = createHash("sha256").update(encryptedBytes).digest("hex");

  if (actualSha256 !== ciphertextSha256) {
    throw new Error("invalid_encrypted_payload");
  }

  return {
    encryptedBytes,
    ciphertextSha256,
    seal: {
      packageId,
      policyId,
      threshold,
      keyServerObjectIds,
    },
  };
}

function optionalSha256(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();

  return /^[a-f0-9]{64}$/.test(normalized) ? normalized : null;
}

function readCountRecord(value: unknown): {
  filesTouched: number;
  commandsRun: number;
  testsRun: number;
  decisions: number;
  bugsFound: number;
  followUps: number;
  userCorrections: number;
} {
  const counts = record(value);

  return {
    filesTouched: readCount(counts["filesTouched"]),
    commandsRun: readCount(counts["commandsRun"]),
    testsRun: readCount(counts["testsRun"]),
    decisions: readCount(counts["decisions"]),
    bugsFound: readCount(counts["bugsFound"]),
    followUps: readCount(counts["followUps"]),
    userCorrections: readCount(counts["userCorrections"]),
  };
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => typeof item === "string" ? item.trim() : "")
    .filter(Boolean);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function toAgentWritebackSummary(row: typeof agentWritebacks.$inferSelect) {
  const payload = record(row.payload);
  const storage = record(payload["storage"]);
  const counts = record(payload["counts"]);

  return {
    id: row.id,
    twinId: row.twinId,
    clientId: row.clientId,
    status: row.status,
    agentName: optionalString(payload["agentName"]) ?? "coding-agent",
    repo: optionalString(payload["repo"]) ?? null,
    branch: optionalString(payload["branch"]) ?? null,
    summarySha256: optionalString(payload["summarySha256"]) ?? null,
    rawStorageRef: optionalString(storage["rawStorageRef"]) ?? null,
    ciphertextSha256: optionalString(storage["ciphertextSha256"]) ?? null,
    approvedArtifactId: optionalString(payload["approvedArtifactId"]) ?? null,
    counts: {
      filesTouched: readCount(counts["filesTouched"]),
      filesChanged: readCount(counts["filesChanged"]),
      commandsRun: readCount(counts["commandsRun"]),
      testsRun: readCount(counts["testsRun"]),
      decisions: readCount(counts["decisions"]),
      bugsFound: readCount(counts["bugsFound"]),
      bugsFixed: readCount(counts["bugsFixed"]),
      reviewComments: readCount(counts["reviewComments"]),
      followUps: readCount(counts["followUps"]),
      userCorrections: readCount(counts["userCorrections"]),
    },
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    approvedAt: row.approvedAt?.toISOString() ?? null,
    rejectedAt: row.rejectedAt?.toISOString() ?? null,
  };
}

function readCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function formatAgentWriteback(input: {
  agentName: string;
  repo?: string;
  branch?: string;
  taskSummary: string;
  filesTouched: string[];
  commandsRun: string[];
  testsRun: string[];
  decisions: string[];
  bugsFound: string[];
  followUps: string[];
  userCorrections: string[];
}): string {
  const lines = [
    "# Coding Agent Writeback",
    "",
    `Agent: ${input.agentName}`,
    `Repo: ${input.repo ?? "unknown"}`,
    `Branch: ${input.branch ?? "unknown"}`,
    "",
    "## Task Summary",
    input.taskSummary,
  ];

  pushList(lines, "Files Touched", input.filesTouched);
  pushList(lines, "Commands Run", input.commandsRun);
  pushList(lines, "Tests Run", input.testsRun);
  pushList(lines, "Decisions", input.decisions);
  pushList(lines, "Bugs Found", input.bugsFound);
  pushList(lines, "Follow Ups", input.followUps);
  pushList(lines, "User Corrections", input.userCorrections);

  return `${lines.join("\n")}\n`;
}

function formatPrOrCommitImportWriteback(input: {
  kind: "pull_request" | "commit";
  agentName: string;
  repo?: string;
  identifier?: string;
  title: string;
  url?: string;
  author?: string;
  mergedAt?: string;
  committedAt?: string;
  summary: string;
  filesChanged: string[];
  commandsRun: string[];
  testsRun: string[];
  decisions: string[];
  bugsFixed: string[];
  reviewComments: string[];
  userCorrections: string[];
}): string {
  const heading = input.kind === "pull_request"
    ? "Pull Request Writeback Import"
    : "Commit Writeback Import";
  const lines = [
    `# ${heading}`,
    "",
    `Agent: ${input.agentName}`,
    `Repo: ${input.repo ?? "unknown"}`,
    `Identifier: ${input.identifier ?? "unknown"}`,
    `Title: ${input.title}`,
    `URL: ${input.url ?? "unknown"}`,
    `Author: ${input.author ?? "unknown"}`,
  ];

  if (input.kind === "pull_request") {
    lines.push(`Merged At: ${input.mergedAt ?? "unknown"}`);
  } else {
    lines.push(`Committed At: ${input.committedAt ?? "unknown"}`);
  }

  lines.push("", "## Summary", input.summary);
  pushList(lines, "Files Changed", input.filesChanged);
  pushList(lines, "Commands Run", input.commandsRun);
  pushList(lines, "Tests Run", input.testsRun);
  pushList(lines, "Decisions", input.decisions);
  pushList(lines, "Bugs Found", input.bugsFixed);
  pushList(lines, "Review Comments", input.reviewComments);
  pushList(lines, "User Corrections", input.userCorrections);

  return `${lines.join("\n")}\n`;
}

function pushList(lines: string[], heading: string, values: string[]): void {
  if (values.length === 0) {
    return;
  }

  lines.push("", `## ${heading}`);
  for (const value of values) {
    lines.push(`- ${value}`);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readAuthConfig() {
  try {
    return loadAuthConfig(process.env);
  } catch {
    return null;
  }
}
