import {
  DEFAULT_MANUAL_MEMORY_SENSITIVITY,
  ENCRYPTED_WALRUS_STORAGE_MODE,
} from "@sivraj/core";
import {
  auditEvents,
  candidateMemories,
  memoryFragments,
  reflectionRuns,
  sourceArtifacts,
} from "@sivraj/db";
import { createHash } from "node:crypto";
import { and, count, eq } from "drizzle-orm";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { AppDependencies, SupportedArtifactSourceType } from "../app.js";
import {
  metadataContainsPlaintextLikeFields,
  readIntelligenceMetadata,
  readIntelligenceStatus,
  readProcessingMetadata,
  readProcessingReason,
  recordMetadata,
  sanitizeSafeMetadata,
} from "../lib/safe-metadata.js";
import { requireAuth, requireScope, type AuthEnv } from "../middleware/auth.js";

const DEFAULT_TRANSIENT_CIPHERTEXT_MAX_BYTES = 2 * 1024 * 1024;

export function createArtifactRoutes({
  db,
  privateMemoryStorage,
  artifactProcessingQueue,
  artifactStatusPublisher,
  artifactStatusSubscriber,
}: AppDependencies) {
  const artifactRoutes = new Hono<AuthEnv>();

  artifactRoutes.post("/", requireAuth, async (c) => {
    const scopeError = requireScope(c, "artifact:upload");

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

    const body = await c.req.json().catch(() => null);

    if (!body || typeof body !== "object") {
      return c.json({ error: "invalid_json_body" }, 400);
    }

    const sourceType = readSupportedSourceType(body["sourceType"]);
    const title = optionalString(body["title"]);
    const content = requiredString(body["content"]);
    const encryptedPayload = (() => {
      try {
        return readEncryptedPayload(body["encryptedPayload"]);
      } catch {
        return "invalid" as const;
      }
    })();
    const privateMetadata = recordMetadata(body["metadata"]);
    const storageMetadata = {
      storageMode: ENCRYPTED_WALRUS_STORAGE_MODE,
      sensitivity: DEFAULT_MANUAL_MEMORY_SENSITIVITY,
      encryptedPayload: {
        kind: "source_artifact",
        version: 1,
        encryptionBoundary: encryptedPayload ? "client" : "api",
      },
    };

    if (!sourceType) {
      return c.json(
        { error: "unsupported_source_type", sourceType: body["sourceType"] },
        400,
      );
    }

    if (encryptedPayload === "invalid") {
      return c.json({ error: "invalid_encrypted_payload" }, 400);
    }

    if (!content && !encryptedPayload) {
      return c.json({ error: "missing_content" }, 400);
    }

    if (!privateMemoryStorage) {
      return c.json({ error: "encrypted_storage_not_configured" }, 503);
    }

    const stored = await (encryptedPayload
      ? privateMemoryStorage.storeEncryptedPrivateMemory({
          twinId,
          sourceType,
          encryptedBytes: encryptedPayload.encryptedBytes,
          ciphertextSha256: encryptedPayload.ciphertextSha256,
          seal: encryptedPayload.seal,
        })
      : privateMemoryStorage.storePrivateMemory({
          twinId,
          sourceType,
          title,
          content: content ?? "",
          metadata: privateMetadata,
        })
    ).catch((error: unknown) => {
      console.error("private memory storage failed", error);
      return null;
    });

    if (!stored) {
      return c.json({ error: "encrypted_storage_failed" }, 503);
    }

    const [artifact] = await db
      .insert(sourceArtifacts)
      .values({
        twinId,
        sourceType,
        metadata: {
          ...storageMetadata,
          ciphertextSha256: stored.ciphertextSha256,
          seal: stored.seal,
          walrus: stored.walrus,
        },
        rawStorageRef: stored.rawStorageRef,
        ingestionStatus: "queued",
      })
      .returning();

    await db.insert(auditEvents).values({
      twinId,
      actorType: auth.type,
      actorId: auth.sub,
      eventType: "artifact.created",
      resourceType: "source_artifact",
      resourceId: artifact.id,
      metadata: {
        memoryFragmentId: null,
        walletAddress: auth.walletAddress,
        storageMode: ENCRYPTED_WALRUS_STORAGE_MODE,
        sensitivity: DEFAULT_MANUAL_MEMORY_SENSITIVITY,
        rawStorageRef: stored.rawStorageRef,
      },
    });

    let processingJobId: string | null = null;
    let warning: string | null = null;

    if (!artifactProcessingQueue) {
      warning = "artifact_processing_queue_not_configured";
    } else {
      const queued = await artifactProcessingQueue
        .enqueueArtifactProcessing({
          artifactId: artifact.id,
          twinId,
          sourceType,
          ...(stored.encryptedBytesBase64 && shouldAttachTransientCiphertextBase64(stored.encryptedBytesBase64)
            ? {
                transientCiphertextBase64: stored.encryptedBytesBase64,
                transientCiphertextSha256: stored.ciphertextSha256,
              }
            : {}),
        })
        .catch(async (error: unknown) => {
          console.error("artifact processing queue enqueue failed", error);

          await db.insert(auditEvents).values({
            twinId,
            actorType: "system",
            actorId: "sivraj-api",
            eventType: "artifact.queue_failed",
            resourceType: "source_artifact",
            resourceId: artifact.id,
            metadata: {
              error: errorMessage(error),
            },
          });

          return null;
        });

      processingJobId = queued?.jobId ?? null;
      warning = queued ? null : "artifact_processing_queue_failed";
    }

    return c.json(
      {
        artifactId: artifact.id,
        memoryFragmentId: null,
        status: artifact.ingestionStatus,
        storageMode: ENCRYPTED_WALRUS_STORAGE_MODE,
        sensitivity: DEFAULT_MANUAL_MEMORY_SENSITIVITY,
        rawStorageRef: stored.rawStorageRef,
        processingJobId,
        warning,
      },
      201,
    );
  });

  artifactRoutes.post("/:artifactId/retry", requireAuth, async (c) => {
    const scopeError = requireScope(c, "artifact:upload");

    if (scopeError) {
      return scopeError;
    }

    const auth = c.get("auth");
    const twinId = c.req.param("twinId");
    const artifactId = c.req.param("artifactId");

    if (!twinId) {
      return c.json({ error: "missing_twin_id" }, 400);
    }

    if (!artifactId) {
      return c.json({ error: "missing_artifact_id" }, 400);
    }

    if (auth.type !== "service" && auth.twinId !== twinId) {
      return c.json({ error: "twin_scope_mismatch" }, 403);
    }

    const [artifact] = await db
      .select()
      .from(sourceArtifacts)
      .where(
        and(
          eq(sourceArtifacts.id, artifactId),
          eq(sourceArtifacts.twinId, twinId),
        ),
      )
      .limit(1);

    if (!artifact) {
      return c.json({ error: "artifact_not_found" }, 404);
    }

    if (artifact.ingestionStatus !== "failed") {
      return c.json(
        {
          error: "artifact_not_failed",
          status: artifact.ingestionStatus,
        },
        409,
      );
    }

    const retryMetadata = {
      ...recordMetadata(artifact.metadata),
      processing: {
        status: "queued",
        reason: "retry_requested",
        retriedAt: new Date().toISOString(),
      },
    };

    const [retried] = await db
      .update(sourceArtifacts)
      .set({
        ingestionStatus: "queued",
        metadata: retryMetadata,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(sourceArtifacts.id, artifactId),
          eq(sourceArtifacts.twinId, twinId),
        ),
      )
      .returning();

    await artifactStatusPublisher?.publishArtifactStatus({
      artifactId,
      twinId,
      sourceType: artifact.sourceType,
      status: "queued",
      reason: "retry_requested",
      occurredAt: new Date().toISOString(),
    });

    await db.insert(auditEvents).values({
      twinId,
      actorType: auth.type,
      actorId: auth.sub,
      eventType: "artifact.retry_requested",
      resourceType: "source_artifact",
      resourceId: artifactId,
      metadata: {
        previousStatus: artifact.ingestionStatus,
        sourceType: artifact.sourceType,
      },
    });

    let processingJobId: string | null = null;
    let warning: string | null = null;

    if (!artifactProcessingQueue) {
      warning = "artifact_processing_queue_not_configured";
    } else {
      const queued = await artifactProcessingQueue
        .enqueueArtifactProcessing({
          artifactId,
          twinId,
          sourceType: artifact.sourceType,
        })
        .catch(async (error: unknown) => {
          console.error("artifact retry queue enqueue failed", error);

          await db.insert(auditEvents).values({
            twinId,
            actorType: "system",
            actorId: "sivraj-api",
            eventType: "artifact.retry_queue_failed",
            resourceType: "source_artifact",
            resourceId: artifactId,
            metadata: {
              error: errorMessage(error),
            },
          });

          return null;
        });

      processingJobId = queued?.jobId ?? null;
      warning = queued ? null : "artifact_processing_queue_failed";
    }

    return c.json({
      artifactId: retried?.id ?? artifactId,
      status: retried?.ingestionStatus ?? "queued",
      processingJobId,
      warning,
    });
  });

  artifactRoutes.get("/:artifactId", requireAuth, async (c) => {
    const scopeError = requireScope(c, "memory:read");

    if (scopeError) {
      return scopeError;
    }

    const auth = c.get("auth");
    const twinId = c.req.param("twinId");
    const artifactId = c.req.param("artifactId");

    if (!twinId) {
      return c.json({ error: "missing_twin_id" }, 400);
    }

    if (!artifactId) {
      return c.json({ error: "missing_artifact_id" }, 400);
    }

    if (auth.type !== "service" && auth.twinId !== twinId) {
      return c.json({ error: "twin_scope_mismatch" }, 403);
    }

    const artifact = await findArtifact(db, twinId, artifactId);

    if (!artifact) {
      return c.json({ error: "artifact_not_found" }, 404);
    }

    const [memoryFragment] = await db
      .select()
      .from(memoryFragments)
      .where(
        and(
          eq(memoryFragments.twinId, twinId),
          eq(memoryFragments.sourceArtifactId, artifactId),
        ),
      )
      .limit(1);

    const [candidateCountRow] = await db
      .select({ count: count() })
      .from(candidateMemories)
      .where(
        and(
          eq(candidateMemories.twinId, twinId),
          eq(candidateMemories.sourceArtifactId, artifactId),
        ),
      );

    return c.json({
      policy: {
        rawArtifactsIncluded: false,
        scope: "memory:read",
      },
      artifact: formatArtifactDetail(artifact, memoryFragment ?? null, candidateCountRow?.count ?? 0),
    });
  });

  artifactRoutes.get("/:artifactId/privacy-check", requireAuth, async (c) => {
    const scopeError = requireScope(c, "memory:read");

    if (scopeError) {
      return scopeError;
    }

    const auth = c.get("auth");
    const twinId = c.req.param("twinId");
    const artifactId = c.req.param("artifactId");

    if (!twinId) {
      return c.json({ error: "missing_twin_id" }, 400);
    }

    if (!artifactId) {
      return c.json({ error: "missing_artifact_id" }, 400);
    }

    if (auth.type !== "service" && auth.twinId !== twinId) {
      return c.json({ error: "twin_scope_mismatch" }, 403);
    }

    const artifact = await findArtifact(db, twinId, artifactId);

    if (!artifact) {
      return c.json({ error: "artifact_not_found" }, 404);
    }

    const [memoryFragment] = await db
      .select()
      .from(memoryFragments)
      .where(
        and(
          eq(memoryFragments.twinId, twinId),
          eq(memoryFragments.sourceArtifactId, artifactId),
        ),
      )
      .limit(1);

    const candidateRows = await db
      .select({
        id: candidateMemories.id,
        statementStorageRef: candidateMemories.statementStorageRef,
        statementSha256: candidateMemories.statementSha256,
      })
      .from(candidateMemories)
      .where(
        and(
          eq(candidateMemories.twinId, twinId),
          eq(candidateMemories.sourceArtifactId, artifactId),
        ),
      );

    const reflectionRows = await db
      .select({
        id: reflectionRuns.id,
        status: reflectionRuns.status,
        summaryStorageRef: reflectionRuns.summaryStorageRef,
        summarySha256: reflectionRuns.summarySha256,
      })
      .from(reflectionRuns)
      .where(
        and(
          eq(reflectionRuns.twinId, twinId),
          eq(reflectionRuns.status, "completed"),
        ),
      )
      .limit(20);

    const metadata = recordMetadata(artifact.metadata);
    const ciphertextSha256 = optionalString(metadata["ciphertextSha256"]);
    const checklist = {
      sourceArtifactHasRawStorageRef: Boolean(artifact.rawStorageRef),
      sourceArtifactHasCiphertextHash: Boolean(ciphertextSha256),
      sourceArtifactMetadataHasNoPlaintextFields: !metadataContainsPlaintextLikeFields(metadata),
      memoryFragmentHasContentStorageRef: Boolean(memoryFragment?.contentStorageRef),
      candidateMemoriesUseStatementStorageRef: candidateRows.every((row) => Boolean(row.statementStorageRef)),
      completedReflectionsUseSummaryStorageRef: reflectionRows.every((row) => Boolean(row.summaryStorageRef)),
    };

    return c.json({
      policy: {
        rawArtifactsIncluded: false,
        scope: "memory:read",
      },
      artifactId,
      twinId,
      checklist,
      allChecksPassed: Object.values(checklist).every(Boolean),
      artifact: {
        id: artifact.id,
        sourceType: artifact.sourceType,
        ingestionStatus: artifact.ingestionStatus,
        rawStorageRef: artifact.rawStorageRef,
        hash: artifact.hash,
        ciphertextSha256,
        storageMode: optionalString(metadata["storageMode"]),
        metadata: sanitizeSafeMetadata(metadata),
      },
      memoryFragment: memoryFragment
        ? {
            id: memoryFragment.id,
            contentStorageRef: memoryFragment.contentStorageRef,
            contentSha256: memoryFragment.contentSha256,
            metadata: sanitizeSafeMetadata(memoryFragment.metadata),
          }
        : null,
      candidateMemories: candidateRows.map((row) => ({
        id: row.id,
        statementStorageRef: row.statementStorageRef,
        statementSha256: row.statementSha256,
      })),
      reflections: reflectionRows.map((row) => ({
        id: row.id,
        status: row.status,
        summaryStorageRef: row.summaryStorageRef,
        summarySha256: row.summarySha256,
      })),
    });
  });

  artifactRoutes.get("/:artifactId/events", requireAuth, async (c) => {
    const auth = c.get("auth");
    const twinId = c.req.param("twinId");
    const artifactId = c.req.param("artifactId");

    if (!twinId) {
      return c.json({ error: "missing_twin_id" }, 400);
    }

    if (!artifactId) {
      return c.json({ error: "missing_artifact_id" }, 400);
    }

    if (auth.type !== "service" && auth.twinId !== twinId) {
      return c.json({ error: "twin_scope_mismatch" }, 403);
    }

    const [artifact] = await db
      .select()
      .from(sourceArtifacts)
      .where(
        and(
          eq(sourceArtifacts.id, artifactId),
          eq(sourceArtifacts.twinId, twinId),
        ),
      )
      .limit(1);

    if (!artifact) {
      return c.json({ error: "artifact_not_found" }, 404);
    }

    const initialEvent = {
      artifactId: artifact.id,
      twinId: artifact.twinId,
      sourceType: artifact.sourceType,
      status: artifact.ingestionStatus,
      intelligenceStatus: readIntelligenceStatus(artifact.metadata),
      reason: readProcessingReason(artifact.metadata),
      occurredAt: new Date().toISOString(),
    };

    return streamSSE(c, async (stream) => {
      await stream.writeSSE({
        event: "artifact.status",
        data: JSON.stringify(initialEvent),
      });

      if (isStreamTerminal(artifact.ingestionStatus, initialEvent.intelligenceStatus) || !artifactStatusSubscriber) {
        return;
      }

      const closed = new Promise<void>((resolve) => {
        c.req.raw.signal.addEventListener("abort", () => resolve(), { once: true });
      });

      let resolveTerminal = () => {};
      const terminal = new Promise<void>((resolve) => {
        resolveTerminal = resolve;
      });

      const unsubscribe = await artifactStatusSubscriber.subscribeToArtifactStatus(
        artifactId,
        async (event) => {
          if (event.twinId !== twinId) {
            return;
          }

          await stream.writeSSE({
            event: "artifact.status",
            data: JSON.stringify(event),
          });

          if (isStreamTerminal(event.status, event.intelligenceStatus)) {
            resolveTerminal();
          }
        },
      );

      try {
        await Promise.race([closed, terminal]);
      } finally {
        await unsubscribe();
      }
    });
  });

  return artifactRoutes;
}

async function findArtifact(
  db: AppDependencies["db"],
  twinId: string,
  artifactId: string,
) {
  const [artifact] = await db
    .select()
    .from(sourceArtifacts)
    .where(
      and(
        eq(sourceArtifacts.id, artifactId),
        eq(sourceArtifacts.twinId, twinId),
      ),
    )
    .limit(1);

  return artifact ?? null;
}

function formatArtifactDetail(
  artifact: typeof sourceArtifacts.$inferSelect,
  memoryFragment: typeof memoryFragments.$inferSelect | null,
  candidateMemoryCount: number,
) {
  const metadata = recordMetadata(artifact.metadata);

  return {
    id: artifact.id,
    twinId: artifact.twinId,
    sourceType: artifact.sourceType,
    uri: artifact.uri,
    rawStorageRef: artifact.rawStorageRef,
    hash: artifact.hash,
    ingestionStatus: artifact.ingestionStatus,
    storageMode: optionalString(metadata["storageMode"]),
    ciphertextSha256: optionalString(metadata["ciphertextSha256"]),
    intelligenceStatus: readIntelligenceStatus(metadata),
    processingReason: readProcessingReason(metadata),
    processing: readProcessingMetadata(metadata),
    intelligence: readIntelligenceMetadata(metadata),
    metadata: sanitizeSafeMetadata(metadata),
    memoryFragment: memoryFragment
      ? {
          id: memoryFragment.id,
          contentStorageRef: memoryFragment.contentStorageRef,
          contentSha256: memoryFragment.contentSha256,
          metadata: sanitizeSafeMetadata(memoryFragment.metadata),
        }
      : null,
    counts: {
      candidateMemories: candidateMemoryCount,
    },
    createdAt: artifact.createdAt.toISOString(),
    updatedAt: artifact.updatedAt.toISOString(),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown queue error";
}

function shouldAttachTransientCiphertextBase64(ciphertextBase64: string): boolean {
  const maxBytes = readTransientCiphertextMaxBytes(process.env["TRANSIENT_CIPHERTEXT_MAX_BYTES"]);
  const approximateBytes = Math.ceil((ciphertextBase64.length * 3) / 4);

  return maxBytes > 0 && approximateBytes <= maxBytes;
}

function readTransientCiphertextMaxBytes(value: string | undefined): number {
  if (!value) {
    return DEFAULT_TRANSIENT_CIPHERTEXT_MAX_BYTES;
  }

  const parsed = Number.parseInt(value, 10);

  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_TRANSIENT_CIPHERTEXT_MAX_BYTES;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function requiredString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
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
  const payload = recordMetadata(value);
  const ciphertextBase64 = optionalString(payload["ciphertextBase64"]);
  const ciphertextSha256 = optionalString(payload["ciphertextSha256"]);
  const seal = recordMetadata(payload["seal"]);
  const packageId = optionalString(seal["packageId"]);
  const policyId = optionalString(seal["policyId"]);
  const threshold = typeof seal["threshold"] === "number" ? seal["threshold"] : null;
  const keyServerObjectIds = Array.isArray(seal["keyServerObjectIds"])
    ? seal["keyServerObjectIds"].filter((item): item is string => typeof item === "string")
    : [];

  if (!ciphertextBase64 && !ciphertextSha256 && Object.keys(seal).length === 0) {
    return null;
  }

  if (!ciphertextBase64 || !ciphertextSha256 || !packageId || !policyId || keyServerObjectIds.length === 0) {
    throw new Error("invalid_encrypted_payload");
  }

  if (typeof threshold !== "number" || !Number.isInteger(threshold) || threshold < 1 || threshold > keyServerObjectIds.length) {
    throw new Error("invalid_encrypted_payload");
  }
  const thresholdValue = threshold;

  if (!/^[a-f0-9]{64}$/i.test(ciphertextSha256)) {
    throw new Error("invalid_encrypted_payload");
  }

  const encryptedBytes = Buffer.from(ciphertextBase64, "base64");

  if (encryptedBytes.length === 0 || encryptedBytes.toString("base64") !== ciphertextBase64) {
    throw new Error("invalid_encrypted_payload");
  }

  const actualSha256 = createHash("sha256").update(encryptedBytes).digest("hex");

  if (actualSha256 !== ciphertextSha256.toLowerCase()) {
    throw new Error("invalid_encrypted_payload");
  }

  return {
    encryptedBytes,
    ciphertextSha256: actualSha256,
    seal: {
      packageId,
      policyId,
      threshold: thresholdValue,
      keyServerObjectIds,
    },
  };
}

function isStreamTerminal(
  status: string,
  intelligenceStatus?: "queued" | "processing" | "completed" | "failed" | "skipped",
): boolean {
  if (status === "failed" || status === "cancelled") {
    return true;
  }

  if (status !== "completed") {
    return false;
  }

  return !intelligenceStatus ||
    intelligenceStatus === "completed" ||
    intelligenceStatus === "failed" ||
    intelligenceStatus === "skipped";
}

function readSupportedSourceType(
  value: unknown,
): SupportedArtifactSourceType | null {
  return value === "note" ||
    value === "browser_history" ||
    value === "markdown" ||
    value === "upload" ||
    value === "pdf" ||
    value === "ocr_pdf" ||
    value === "image" ||
    value === "voice_note" ||
    value === "voice_conversation" ||
    value === "onboarding_self_description" ||
    value === "docx" ||
    value === "csv" ||
    value === "email" ||
    value === "chat_export" ||
    value === "slack_export" ||
    value === "whatsapp_export" ||
    value === "github"
    ? value
    : null;
}
