import { AGENT_WRITEBACK_CREATE_SCOPE } from "@sivraj/auth";
import {
  DEFAULT_MANUAL_MEMORY_SENSITIVITY,
  ENCRYPTED_WALRUS_STORAGE_MODE,
  formatAgentWriteback,
} from "@sivraj/core";
import { agentWritebacks, auditEvents, sourceArtifacts } from "@sivraj/db";
import { and, desc, eq } from "drizzle-orm";
import type { Context } from "hono";
import type { AppDependencies } from "../app.js";
import {
  authorizeTwinScopedJsonBodyWithAgentGrant,
  requireAgentClient,
  type AuthorizedTwin,
} from "../lib/http/route-auth.js";
import {
  buildWritebackPayload,
  readPrOrCommitImportPayload,
  toAgentWritebackSummary,
  validateWritebackCreateInput,
} from "../lib/agent-writebacks/input.js";
import {
  optionalString,
  readBodyEncryptedPayload,
  readRecord,
  sha256Hex,
} from "../lib/http/route-helpers.js";
import type { AuthEnv } from "../middleware/auth.js";
import { errorMessage, readLimit, readWritebackStatus } from "../lib/agent-tokens/helpers.js";

export async function handleCreateAgentWriteback(
  c: Context<AuthEnv>,
  input: {
    db: AppDependencies["db"];
    privateMemoryStorage: AppDependencies["privateMemoryStorage"];
    transientCiphertextCache: AppDependencies["transientCiphertextCache"];
    auth: AuthorizedTwin["auth"];
    twinId: string;
    body: Record<string, unknown>;
  },
) {
  const validation = validateWritebackCreateInput(input.body);

  if (!validation.ok) {
    return c.json(validation.error.body, validation.error.status);
  }

  if (!input.privateMemoryStorage) {
    return c.json({ error: "encrypted_storage_not_configured" }, 503);
  }

  const clientError = requireAgentClient(c, input.auth);

  if (clientError) {
    return clientError;
  }

  const stored = await storeAgentWritebackContent(input.privateMemoryStorage, {
    twinId: input.twinId,
    ...validation.value,
  });

  if (!stored) {
    return c.json({ error: "encrypted_storage_failed" }, 503);
  }

  const writeback = await insertPendingAgentWriteback(input.db, {
    twinId: input.twinId,
    clientId: input.auth.clientId!,
    validation: validation.value,
    stored,
  });

  await cacheWritebackTransientCiphertext(input.transientCiphertextCache, writeback.id, stored);
  await recordWritebackCreatedAudit(input.db, input, writeback.id, validation.value, stored);

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
}

export async function handleListAgentWritebacks(
  c: Context<AuthEnv>,
  db: AppDependencies["db"],
  { auth, twinId }: AuthorizedTwin,
) {
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
}

export async function handleApproveAgentWriteback(
  c: Context<AuthEnv>,
  input: {
    db: AppDependencies["db"];
    artifactProcessingQueue: AppDependencies["artifactProcessingQueue"];
    transientCiphertextCache: AppDependencies["transientCiphertextCache"];
    auth: AuthorizedTwin["auth"];
    twinId: string;
    writebackId: string;
    writeback: typeof agentWritebacks.$inferSelect;
  },
) {
  if (input.writeback.status !== "pending") {
    return c.json({ error: "agent_writeback_not_pending" }, 409);
  }

  const storageRefs = readWritebackStorageRefs(input.writeback.payload);

  if (!storageRefs.ok) {
    return c.json({ error: storageRefs.error }, 409);
  }

  const artifact = await insertApprovedWritebackArtifact(input.db, input, storageRefs);
  const queued = await approveWritebackArtifact({
    db: input.db,
    artifactProcessingQueue: input.artifactProcessingQueue,
    transientCiphertextCache: input.transientCiphertextCache,
    twinId: input.twinId,
    writeback: input.writeback,
    artifact,
  });
  const updated = await markWritebackApproved(input.db, input, artifact.id);

  await input.db.insert(auditEvents).values({
    twinId: input.twinId,
    actorType: input.auth.type,
    actorId: input.auth.sub,
    eventType: "agent.writeback.approved",
    resourceType: "agent_writeback",
    resourceId: input.writeback.id,
    metadata: {
      clientId: input.writeback.clientId,
      artifactId: artifact.id,
      processingJobId: queued.processingJobId,
    },
  });

  return c.json({
    writebackId: updated?.id ?? input.writeback.id,
    artifactId: artifact.id,
    status: artifact.ingestionStatus,
    storageMode: ENCRYPTED_WALRUS_STORAGE_MODE,
    rawStorageRef: storageRefs.rawStorageRef,
    processingJobId: queued.processingJobId,
    warning: queued.warning,
  });
}

export async function handleRejectAgentWriteback(
  c: Context<AuthEnv>,
  db: AppDependencies["db"],
  input: {
    auth: AuthorizedTwin["auth"];
    twinId: string;
    writebackId: string;
  },
) {
  const now = new Date();
  const [writeback] = await db
    .update(agentWritebacks)
    .set({
      status: "rejected",
      rejectedAt: now,
      updatedAt: now,
    })
    .where(and(
      eq(agentWritebacks.id, input.writebackId),
      eq(agentWritebacks.twinId, input.twinId),
    ))
    .returning();

  if (!writeback) {
    return c.json({ error: "agent_writeback_not_found" }, 404);
  }

  await db.insert(auditEvents).values({
    twinId: input.twinId,
    actorType: input.auth.type,
    actorId: input.auth.sub,
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
}

export async function createPrOrCommitWritebackImport(
  c: Context<AuthEnv>,
  input: {
    db: AppDependencies["db"];
    privateMemoryStorage: AppDependencies["privateMemoryStorage"];
    transientCiphertextCache: AppDependencies["transientCiphertextCache"];
    kind: "pull_request" | "commit";
  },
): Promise<Response> {
  const routeAuth = await authorizeTwinScopedJsonBodyWithAgentGrant(c, {
    scopes: [AGENT_WRITEBACK_CREATE_SCOPE, "artifact:upload"],
    db: input.db,
    acceptedAgentScopes: [AGENT_WRITEBACK_CREATE_SCOPE],
  });
  if (!routeAuth.ok) {
    return routeAuth.response;
  }
  const { auth, twinId, body: payload } = routeAuth.value;

  if (!input.privateMemoryStorage) {
    return c.json({ error: "encrypted_storage_not_configured" }, 503);
  }

  const clientError = requireAgentClient(c, auth);
  if (clientError) {
    return clientError;
  }

  const parsedImport = readPrOrCommitImportPayload(payload, input.kind);
  if (!parsedImport.ok) {
    return c.json(parsedImport.error.body, parsedImport.error.status);
  }

  const stored = await storePrOrCommitImportWriteback(input.privateMemoryStorage, {
    twinId,
    kind: input.kind,
    ...parsedImport.value,
  });

  if (!stored) {
    return c.json({ error: "encrypted_storage_failed" }, 503);
  }

  const writeback = await insertPrOrCommitImportWriteback(input.db, {
    twinId,
    clientId: auth.clientId!,
    kind: input.kind,
    ...parsedImport.value,
    stored,
  });

  await cacheWritebackTransientCiphertext(input.transientCiphertextCache, writeback.id, stored);
  await recordPrOrCommitImportAudit(input.db, {
    twinId,
    auth,
    kind: input.kind,
    writebackId: writeback.id,
    parsedImport: parsedImport.value,
    stored,
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

async function insertPendingAgentWriteback(
  db: AppDependencies["db"],
  input: {
    twinId: string;
    clientId: string;
    validation: Extract<ReturnType<typeof validateWritebackCreateInput>, { ok: true }>["value"];
    stored: NonNullable<Awaited<ReturnType<typeof storeAgentWritebackContent>>>;
  },
) {
  const [writeback] = await db
    .insert(agentWritebacks)
    .values({
      twinId: input.twinId,
      clientId: input.clientId,
      status: "pending",
      payload: buildWritebackPayload(input.validation, input.stored),
    })
    .returning();

  return writeback;
}

async function recordWritebackCreatedAudit(
  db: AppDependencies["db"],
  input: {
    auth: AuthorizedTwin["auth"];
    twinId: string;
  },
  writebackId: string,
  validation: { agentName: string; encryptedPayload: ReturnType<typeof readBodyEncryptedPayload> },
  stored: NonNullable<Awaited<ReturnType<typeof storeAgentWritebackContent>>>,
) {
  await db.insert(auditEvents).values({
    twinId: input.twinId,
    actorType: input.auth.type,
    actorId: input.auth.sub,
    eventType: "agent.writeback.created",
    resourceType: "agent_writeback",
    resourceId: writebackId,
    metadata: {
      clientId: input.auth.clientId,
      agentName: validation.agentName,
      rawStorageRef: stored.rawStorageRef,
      storageMode: ENCRYPTED_WALRUS_STORAGE_MODE,
      encryptionBoundary: validation.encryptedPayload ? "client" : "api",
      status: "pending",
    },
  });
}

async function insertApprovedWritebackArtifact(
  db: AppDependencies["db"],
  input: {
    twinId: string;
    writeback: typeof agentWritebacks.$inferSelect;
  },
  storageRefs: Extract<ReturnType<typeof readWritebackStorageRefs>, { ok: true }>,
) {
  const [artifact] = await db
    .insert(sourceArtifacts)
    .values({
      twinId: input.twinId,
      sourceType: "note",
      metadata: {
        ...storageRefs.artifactMetadata,
        ciphertextSha256: storageRefs.ciphertextSha256,
        seal: storageRefs.storage["seal"] ?? null,
        walrus: storageRefs.storage["walrus"] ?? null,
        agentWritebackId: input.writeback.id,
      },
      rawStorageRef: storageRefs.rawStorageRef,
      ingestionStatus: "queued",
    })
    .returning();

  return artifact;
}

async function markWritebackApproved(
  db: AppDependencies["db"],
  input: {
    twinId: string;
    writeback: typeof agentWritebacks.$inferSelect;
  },
  artifactId: string,
) {
  const now = new Date();
  const [updated] = await db
    .update(agentWritebacks)
    .set({
      status: "approved",
      approvedAt: now,
      updatedAt: now,
      payload: {
        ...readRecord(input.writeback.payload),
        approvedArtifactId: artifactId,
        approvedAt: now.toISOString(),
      },
    })
    .where(and(
      eq(agentWritebacks.id, input.writeback.id),
      eq(agentWritebacks.twinId, input.twinId),
    ))
    .returning();

  return updated;
}

async function recordPrOrCommitImportAudit(
  db: AppDependencies["db"],
  input: {
    twinId: string;
    auth: AuthorizedTwin["auth"];
    kind: "pull_request" | "commit";
    writebackId: string;
    parsedImport: {
      agentName: string;
      repo: string | null;
      identifier: string | null;
    };
    stored: NonNullable<Awaited<ReturnType<typeof storePrOrCommitImportWriteback>>>;
  },
) {
  await db.insert(auditEvents).values({
    twinId: input.twinId,
    actorType: input.auth.type,
    actorId: input.auth.sub,
    eventType: input.kind === "pull_request" ? "agent.writeback_pr_import.created" : "agent.writeback_commit_import.created",
    resourceType: "agent_writeback",
    resourceId: input.writebackId,
    metadata: {
      clientId: input.auth.clientId,
      agentName: input.parsedImport.agentName,
      repo: input.parsedImport.repo ?? null,
      identifier: input.parsedImport.identifier ?? null,
      rawStorageRef: input.stored.rawStorageRef,
      storageMode: ENCRYPTED_WALRUS_STORAGE_MODE,
      status: "pending",
    },
  });
}

async function storeAgentWritebackContent(
  privateMemoryStorage: NonNullable<AppDependencies["privateMemoryStorage"]>,
  input: {
    twinId: string;
    encryptedPayload: ReturnType<typeof readBodyEncryptedPayload>;
    agentName: string;
    writebackPayload: {
      agentName: string;
      repo: string | null;
      branch: string | null;
      taskSummary: string;
      filesTouched: string[];
      commandsRun: string[];
      testsRun: string[];
      decisions: string[];
      bugsFound: string[];
      followUps: string[];
      userCorrections: string[];
    };
    metadata: Record<string, unknown>;
  },
) {
  const content = formatAgentWriteback({
    ...input.writebackPayload,
    repo: input.writebackPayload.repo ?? undefined,
    branch: input.writebackPayload.branch ?? undefined,
  });

  return (input.encryptedPayload && input.encryptedPayload !== "invalid"
    ? privateMemoryStorage.storeEncryptedPrivateMemory({
        twinId: input.twinId,
        sourceType: "note",
        encryptedBytes: input.encryptedPayload.encryptedBytes,
        ciphertextSha256: input.encryptedPayload.ciphertextSha256,
        seal: input.encryptedPayload.seal,
      })
    : privateMemoryStorage.storePrivateMemory({
        twinId: input.twinId,
        sourceType: "note",
        title: `Coding agent writeback: ${input.agentName}`,
        content,
        metadata: input.metadata,
      })
  ).catch((error: unknown) => {
    console.error("agent writeback encrypted storage failed", error);
    return null;
  });
}

async function cacheWritebackTransientCiphertext(
  transientCiphertextCache: AppDependencies["transientCiphertextCache"],
  writebackId: string,
  stored: NonNullable<Awaited<ReturnType<typeof storeAgentWritebackContent>>>,
) {
  if (!stored.encryptedBytesBase64) {
    return;
  }

  await transientCiphertextCache?.putArtifactCiphertext({
    artifactId: writebackId,
    ciphertextBase64: stored.encryptedBytesBase64,
    ciphertextSha256: stored.ciphertextSha256,
  }).catch((error: unknown) => {
    console.warn("agent writeback transient ciphertext cache failed", {
      writebackId,
      error: errorMessage(error),
    });
  });
}

function readWritebackStorageRefs(payload: unknown) {
  const record = readRecord(payload);
  const storage = readRecord(record["storage"]);
  const artifactMetadata = readRecord(record["artifactMetadata"]);
  const rawStorageRef = optionalString(storage["rawStorageRef"]);
  const ciphertextSha256 = optionalString(storage["ciphertextSha256"]);

  if (!rawStorageRef || !ciphertextSha256) {
    return { ok: false as const, error: "agent_writeback_storage_missing" };
  }

  return {
    ok: true as const,
    rawStorageRef,
    ciphertextSha256,
    storage,
    artifactMetadata,
  };
}

async function approveWritebackArtifact(input: {
  db: AppDependencies["db"];
  artifactProcessingQueue: AppDependencies["artifactProcessingQueue"];
  transientCiphertextCache: AppDependencies["transientCiphertextCache"];
  twinId: string;
  writeback: typeof agentWritebacks.$inferSelect;
  artifact: typeof sourceArtifacts.$inferSelect;
}) {
  const transient = await input.transientCiphertextCache
    ?.getArtifactCiphertext(input.writeback.id)
    .catch((error: unknown) => {
      console.warn("agent writeback transient ciphertext lookup failed", {
        writebackId: input.writeback.id,
        error: errorMessage(error),
      });
      return null;
    }) ?? null;

  if (transient) {
    await input.transientCiphertextCache?.putArtifactCiphertext({
      artifactId: input.artifact.id,
      ciphertextBase64: transient.ciphertextBase64,
      ciphertextSha256: transient.ciphertextSha256,
    }).catch((error: unknown) => {
      console.warn("approved writeback transient ciphertext cache failed", {
        artifactId: input.artifact.id,
        writebackId: input.writeback.id,
        error: errorMessage(error),
      });
    });
  }

  if (!input.artifactProcessingQueue) {
    return {
      processingJobId: null,
      warning: "artifact_processing_queue_not_configured",
    };
  }

  return enqueueApprovedWritebackProcessing({
    db: input.db,
    artifactProcessingQueue: input.artifactProcessingQueue,
    twinId: input.twinId,
    writeback: input.writeback,
    artifact: input.artifact,
  }, transient);
}

async function enqueueApprovedWritebackProcessing(
  input: {
    db: AppDependencies["db"];
    artifactProcessingQueue: NonNullable<AppDependencies["artifactProcessingQueue"]>;
    twinId: string;
    writeback: typeof agentWritebacks.$inferSelect;
    artifact: typeof sourceArtifacts.$inferSelect;
  },
  transient: { ciphertextBase64: string; ciphertextSha256: string } | null,
) {
  const queued = await input.artifactProcessingQueue.enqueueArtifactProcessing({
    artifactId: input.artifact.id,
    twinId: input.twinId,
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
    await input.db.insert(auditEvents).values({
      twinId: input.twinId,
      actorType: "system",
      actorId: "sivraj-api",
      eventType: "agent.writeback_queue_failed",
      resourceType: "source_artifact",
      resourceId: input.artifact.id,
      metadata: {
        clientId: input.writeback.clientId,
        error: errorMessage(error),
      },
    });
    return null;
  });

  return {
    processingJobId: queued?.jobId ?? null,
    warning: queued ? null : "artifact_processing_queue_failed",
  };
}

async function storePrOrCommitImportWriteback(
  privateMemoryStorage: NonNullable<AppDependencies["privateMemoryStorage"]>,
  input: {
    twinId: string;
    kind: "pull_request" | "commit";
    title: string;
    content: string;
    metadata: Record<string, unknown>;
  },
) {
  return privateMemoryStorage.storePrivateMemory({
    twinId: input.twinId,
    sourceType: "note",
    title: input.kind === "pull_request"
      ? `PR writeback import: ${input.title}`
      : `Commit writeback import: ${input.title}`,
    content: input.content,
    metadata: input.metadata,
  }).catch((error: unknown) => {
    console.error("agent writeback import encrypted storage failed", error);
    return null;
  });
}

async function insertPrOrCommitImportWriteback(
  db: AppDependencies["db"],
  input: {
    twinId: string;
    clientId: string;
    kind: "pull_request" | "commit";
    agentName: string;
    repo: string | null;
    identifier: string | null;
    title: string;
    summary: string;
    filesChanged: string[];
    commandsRun: string[];
    testsRun: string[];
    decisions: string[];
    bugsFixed: string[];
    reviewComments: string[];
    userCorrections: string[];
    metadata: Record<string, unknown>;
    stored: NonNullable<Awaited<ReturnType<typeof storePrOrCommitImportWriteback>>>;
  },
) {
  const [writeback] = await db
    .insert(agentWritebacks)
    .values({
      twinId: input.twinId,
      clientId: input.clientId,
      status: "pending",
      payload: {
        kind: input.kind === "pull_request" ? "coding_agent_pr_import" : "coding_agent_commit_import",
        agentName: input.agentName,
        repo: input.repo,
        identifier: input.identifier,
        titleSha256: sha256Hex(input.title),
        summarySha256: sha256Hex(input.summary),
        counts: {
          filesChanged: input.filesChanged.length,
          commandsRun: input.commandsRun.length,
          testsRun: input.testsRun.length,
          decisions: input.decisions.length,
          bugsFixed: input.bugsFixed.length,
          reviewComments: input.reviewComments.length,
          userCorrections: input.userCorrections.length,
        },
        storage: {
          rawStorageRef: input.stored.rawStorageRef,
          ciphertextSha256: input.stored.ciphertextSha256,
          seal: input.stored.seal,
          walrus: input.stored.walrus,
          storageMode: ENCRYPTED_WALRUS_STORAGE_MODE,
          sensitivity: DEFAULT_MANUAL_MEMORY_SENSITIVITY,
        },
        artifactMetadata: input.metadata,
      },
    })
    .returning();

  return writeback;
}
