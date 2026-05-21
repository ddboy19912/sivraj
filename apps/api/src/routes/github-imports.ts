import {
  DEFAULT_MANUAL_MEMORY_SENSITIVITY,
  ENCRYPTED_WALRUS_STORAGE_MODE,
} from "@sivraj/core";
import { auditEvents, sourceArtifacts } from "@sivraj/db";
import { importPublicGitHubRepository, type GitHubImportResult } from "@sivraj/ingestion";
import { Hono } from "hono";
import type { AppDependencies } from "../app.js";
import { requireAuth, requireScope, type AuthEnv } from "../middleware/auth.js";

export type GitHubImporter = (input: { repoUrl: string }) => Promise<GitHubImportResult>;

export function createGitHubImportRoutes({
  db,
  privateMemoryStorage,
  artifactProcessingQueue,
  githubImporter = ({ repoUrl }) => importPublicGitHubRepository({ repoUrl }),
}: AppDependencies) {
  const routes = new Hono<AuthEnv>();

  routes.post("/", requireAuth, async (c) => {
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

    const repoUrl = requiredString(body["repoUrl"]);

    if (!repoUrl) {
      return c.json({ error: "missing_repo_url" }, 400);
    }

    if (!privateMemoryStorage) {
      return c.json({ error: "encrypted_storage_not_configured" }, 503);
    }

    let imported: GitHubImportResult;

    try {
      imported = await githubImporter({ repoUrl });
    } catch (error) {
      const importError = error instanceof Error ? error : new Error("github_import_failed");
      return c.json({ error: readImportError(importError) }, readImportStatus(importError));
    }

    const privateMetadata = imported.metadata;
    const storageMetadata = {
      storageMode: ENCRYPTED_WALRUS_STORAGE_MODE,
      sensitivity: DEFAULT_MANUAL_MEMORY_SENSITIVITY,
      encryptedPayload: {
        kind: "source_artifact",
        version: 1,
      },
    };
    const stored = await privateMemoryStorage
      .storePrivateMemory({
        twinId,
        sourceType: "github",
        title: imported.title,
        content: imported.content,
        metadata: privateMetadata,
      })
      .catch((error: unknown) => {
        console.error("private GitHub import storage failed", error);
        return null;
      });

    if (!stored) {
      return c.json({ error: "encrypted_storage_failed" }, 503);
    }

    const [artifact] = await db
      .insert(sourceArtifacts)
      .values({
        twinId,
        sourceType: "github",
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
      eventType: "github_import.created",
      resourceType: "source_artifact",
      resourceId: artifact.id,
      metadata: {
        walletAddress: auth.walletAddress,
        storageMode: ENCRYPTED_WALRUS_STORAGE_MODE,
        sensitivity: DEFAULT_MANUAL_MEMORY_SENSITIVITY,
        rawStorageRef: stored.rawStorageRef,
        fileCount: imported.metadata.files.length,
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
          sourceType: "github",
        })
        .catch(async (error: unknown) => {
          console.error("GitHub import queue enqueue failed", error);

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
        github: {
          repoUrl: imported.repoUrl,
          owner: imported.owner,
          repo: imported.repo,
          fileCount: imported.metadata.files.length,
        },
      },
      201,
    );
  });

  return routes;
}

function requiredString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readImportError(error: Error): string {
  return error.message.startsWith("github_") || error.message === "invalid_github_repo_url"
    ? error.message
    : "github_import_failed";
}

function readImportStatus(error: Error): 400 | 404 | 429 | 502 {
  if (error.message === "invalid_github_repo_url" || error.message === "github_import_no_supported_files") {
    return 400;
  }

  if (error.message === "github_repo_not_found") {
    return 404;
  }

  if (error.message === "github_rate_limited") {
    return 429;
  }

  return 502;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown queue error";
}
