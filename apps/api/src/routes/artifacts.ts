import {
  DEFAULT_MANUAL_MEMORY_SENSITIVITY,
  ENCRYPTED_WALRUS_STORAGE_MODE,
} from "@sivraj/core";
import { auditEvents, sourceArtifacts } from "@sivraj/db";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { AppDependencies, SupportedArtifactSourceType } from "../app.js";
import { requireAuth, requireScope, type AuthEnv } from "../middleware/auth.js";

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
    const privateMetadata = recordMetadata(body["metadata"]);
    const storageMetadata = {
      storageMode: ENCRYPTED_WALRUS_STORAGE_MODE,
      sensitivity: DEFAULT_MANUAL_MEMORY_SENSITIVITY,
      encryptedPayload: {
        kind: "source_artifact",
        version: 1,
      },
    };

    if (!sourceType) {
      return c.json(
        { error: "unsupported_source_type", sourceType: body["sourceType"] },
        400,
      );
    }

    if (!content) {
      return c.json({ error: "missing_content" }, 400);
    }

    if (!privateMemoryStorage) {
      return c.json({ error: "encrypted_storage_not_configured" }, 503);
    }

    const stored = await privateMemoryStorage
      .storePrivateMemory({
        twinId,
        sourceType,
        title,
        content,
        metadata: privateMetadata,
      })
      .catch((error: unknown) => {
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
      reason: readProcessingReason(artifact.metadata),
      occurredAt: new Date().toISOString(),
    };

    return streamSSE(c, async (stream) => {
      await stream.writeSSE({
        event: "artifact.status",
        data: JSON.stringify(initialEvent),
      });

      if (isTerminalStatus(artifact.ingestionStatus) || !artifactStatusSubscriber) {
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

          if (isTerminalStatus(event.status)) {
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown queue error";
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function requiredString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function recordMetadata(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readProcessingReason(metadata: unknown): string | undefined {
  const processing = recordMetadata(recordMetadata(metadata)["processing"]);
  const reason = processing["reason"];

  return typeof reason === "string" ? reason : undefined;
}

function isTerminalStatus(status: string): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
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
