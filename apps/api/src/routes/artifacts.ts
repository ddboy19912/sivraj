import {
  DEFAULT_MANUAL_MEMORY_SENSITIVITY,
  ENCRYPTED_WALRUS_STORAGE_MODE,
} from "@sivraj/core";
import { auditEvents, sourceArtifacts } from "@sivraj/db";
import { Hono } from "hono";
import type { AppDependencies, SupportedArtifactSourceType } from "../app.js";
import { requireAuth, requireScope, type AuthEnv } from "../middleware/auth.js";

export function createArtifactRoutes({
  db,
  privateMemoryStorage,
  artifactProcessingQueue,
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
    const metadata = {
      ...recordMetadata(body["metadata"]),
      storageMode: ENCRYPTED_WALRUS_STORAGE_MODE,
      sensitivity: DEFAULT_MANUAL_MEMORY_SENSITIVITY,
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
        metadata,
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
        title,
        metadata: {
          ...metadata,
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

function readSupportedSourceType(
  value: unknown,
): SupportedArtifactSourceType | null {
  return value === "note" ||
    value === "markdown" ||
    value === "upload" ||
    value === "pdf"
    ? value
    : null;
}
