import {
  DEFAULT_MANUAL_MEMORY_SENSITIVITY,
  ENCRYPTED_WALRUS_STORAGE_MODE,
} from "@sivraj/core";
import { auditEvents } from "@sivraj/db";
import { importPublicGitHubRepository, type GitHubImportResult } from "@sivraj/ingestion";
import type { Context } from "hono";
import type { AppDependencies } from "../app.js";
import type { AuthEnv } from "../middleware/auth.js";
import type { AuthorizedTwin } from "../lib/http/route-auth.js";
import {
  enqueueArtifactProcessingJob,
  insertQueuedSourceArtifact,
  requiredString,
} from "../lib/http/route-helpers.js";

export type GitHubImporter = (input: { repoUrl: string }) => Promise<GitHubImportResult>;

export async function handleGitHubImportPost(
  c: Context<AuthEnv>,
  deps: AppDependencies & { githubImporter?: GitHubImporter },
  { auth, twinId, body }: AuthorizedTwin & { body: Record<string, unknown> },
) {
  const { db, privateMemoryStorage, artifactProcessingQueue } = deps;
  const githubImporter = deps.githubImporter ?? (({ repoUrl }) => importPublicGitHubRepository({ repoUrl }));
  const repoUrl = requiredString(body["repoUrl"]);

  if (!repoUrl) {
    return c.json({ error: "missing_repo_url" }, 400);
  }

  if (!privateMemoryStorage) {
    return c.json({ error: "encrypted_storage_not_configured" }, 503);
  }

  const importResult = await importGitHubRepository(githubImporter, repoUrl, c);

  if ("response" in importResult) {
    return importResult.response;
  }

  const { imported } = importResult;
  const stored = await storeGitHubImport(privateMemoryStorage, twinId, imported);

  if (!stored) {
    return c.json({ error: "encrypted_storage_failed" }, 503);
  }

  const artifact = await insertQueuedSourceArtifact({
    db,
    twinId,
    sourceType: "github",
    storageMetadata: {
      storageMode: ENCRYPTED_WALRUS_STORAGE_MODE,
      sensitivity: DEFAULT_MANUAL_MEMORY_SENSITIVITY,
      encryptedPayload: {
        kind: "source_artifact",
        version: 1,
      },
    },
    stored,
  });

  await recordGitHubImportAudit(db, { auth, twinId, artifactId: artifact.id, stored, imported });

  const { processingJobId, warning } = await enqueueArtifactProcessingJob({
    db,
    artifactProcessingQueue,
    twinId,
    artifactId: artifact.id,
    sourceType: "github",
  });

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
}

async function importGitHubRepository(
  githubImporter: GitHubImporter,
  repoUrl: string,
  c: Context<AuthEnv>,
) {
  try {
    return { imported: await githubImporter({ repoUrl }) };
  } catch (error) {
    const importError = error instanceof Error ? error : new Error("github_import_failed");
    return { response: c.json({ error: readImportError(importError) }, readImportStatus(importError)) };
  }
}

async function storeGitHubImport(
  privateMemoryStorage: NonNullable<AppDependencies["privateMemoryStorage"]>,
  twinId: string,
  imported: GitHubImportResult,
) {
  return privateMemoryStorage
    .storePrivateMemory({
      twinId,
      sourceType: "github",
      title: imported.title,
      content: imported.content,
      metadata: imported.metadata,
    })
    .catch((error: unknown) => {
      console.error("private GitHub import storage failed", error);
      return null;
    });
}

async function recordGitHubImportAudit(
  db: AppDependencies["db"],
  input: {
    auth: AuthorizedTwin["auth"];
    twinId: string;
    artifactId: string;
    stored: { rawStorageRef: string };
    imported: GitHubImportResult;
  },
) {
  await db.insert(auditEvents).values({
    twinId: input.twinId,
    actorType: input.auth.type,
    actorId: input.auth.sub,
    eventType: "github_import.created",
    resourceType: "source_artifact",
    resourceId: input.artifactId,
    metadata: {
      walletAddress: input.auth.walletAddress,
      storageMode: ENCRYPTED_WALRUS_STORAGE_MODE,
      sensitivity: DEFAULT_MANUAL_MEMORY_SENSITIVITY,
      rawStorageRef: input.stored.rawStorageRef,
      fileCount: input.imported.metadata.files.length,
    },
  });
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
