import {
  DEFAULT_MANUAL_MEMORY_SENSITIVITY,
  ENCRYPTED_WALRUS_STORAGE_MODE,
} from "@sivraj/core";
import { auditEvents, candidateMemories, sourceArtifacts } from "@sivraj/db";
import { and, count, eq } from "drizzle-orm";
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import type { AppDependencies } from "../app.js";
import {
  readIntelligenceStatus,
  readProcessingReason,
  sanitizeSafeMetadata,
} from "../lib/safe-metadata.js";
import type { AuthEnv } from "../middleware/auth.js";
import { findDuplicateAiChatImport } from "../lib/artifacts/ai-chat-fingerprint.js";
import {
  buildArtifactPrivacyChecklist,
  enqueueArtifactRetryJob,
  formatArtifactDetail,
  isArtifactUploadValidationError,
  isStreamTerminal,
  loadArtifactPrivacyRows,
  parseArtifactUploadInput,
  shouldAttachTransientCiphertextBase64,
  storeArtifactUpload,
  updateArtifactForRetry,
  type ParsedArtifactUploadInput,
} from "../lib/artifacts/helpers.js";
import type { AuthorizedTwin } from "../lib/http/route-auth.js";
import {
  enqueueArtifactProcessingJob,
  insertQueuedSourceArtifact,
  loadPrimaryMemoryFragment,
  optionalString,
  type StoredPrivateMemory,
} from "../lib/http/route-helpers.js";

export async function handleArtifactUpload(
  c: Context<AuthEnv>,
  deps: AppDependencies,
  { auth, twinId, body }: AuthorizedTwin & { body: Record<string, unknown> },
) {
  const { db, privateMemoryStorage } = deps;
  const parsedInput = parseArtifactUploadInput(body);

  if (isArtifactUploadValidationError(parsedInput)) {
    return c.json(parsedInput.error.body, parsedInput.error.status);
  }

  if (!privateMemoryStorage) {
    return c.json({ error: "encrypted_storage_not_configured" }, 503);
  }

  const duplicateResponse = await findDuplicateAiChatImport(c, {
    db,
    auth,
    twinId,
    fingerprint: parsedInput.aiChatImportFingerprint,
    aiChatImportMetadata: parsedInput.aiChatImportMetadata,
  });

  if (duplicateResponse) {
    return duplicateResponse;
  }

  const stored = await storeArtifactUpload(privateMemoryStorage, {
    twinId,
    sourceType: parsedInput.sourceType,
    title: parsedInput.title,
    content: parsedInput.content,
    encryptedPayload: parsedInput.encryptedPayload,
    privateMetadata: parsedInput.privateMetadata,
  });

  if (!stored.ok) {
    return c.json(stored.error, 503);
  }

  return completeArtifactUpload(c, deps, { auth, twinId, parsedInput, stored: stored.value });
}

export async function handleArtifactRetry(
  c: Context<AuthEnv>,
  deps: AppDependencies,
  { auth, twinId, artifact }: { auth: AuthorizedTwin["auth"]; twinId: string; artifact: typeof sourceArtifacts.$inferSelect },
) {
  const { db, artifactProcessingQueue } = deps;
  const processingReason = readProcessingReason(artifact.metadata);
  const canRetry = artifact.ingestionStatus === "failed" ||
    processingReason === "encrypted_decryption_retrying";

  if (!canRetry) {
    return c.json(
      {
        error: "artifact_not_retryable",
        status: artifact.ingestionStatus,
        reason: processingReason ?? null,
      },
      409,
    );
  }

  const retried = await updateArtifactForRetry(db, deps.artifactStatusPublisher, {
    auth,
    twinId,
    artifact,
  });

  const queueResult = await enqueueArtifactRetryJob({
    db,
    artifactProcessingQueue,
    twinId,
    artifactId: artifact.id,
    sourceType: artifact.sourceType,
  });

  return c.json({
    artifactId: retried?.id ?? artifact.id,
    status: retried?.ingestionStatus ?? "queued",
    processingJobId: queueResult.processingJobId,
    warning: queueResult.warning,
  });
}

export async function handleArtifactGet(
  c: Context<AuthEnv>,
  db: AppDependencies["db"],
  { twinId, artifact }: { twinId: string; artifact: typeof sourceArtifacts.$inferSelect },
) {
  const memoryFragment = await loadPrimaryMemoryFragment(db, twinId, artifact.id);
  const [candidateCountRow] = await db
    .select({ count: count() })
    .from(candidateMemories)
    .where(
      and(
        eq(candidateMemories.twinId, twinId),
        eq(candidateMemories.sourceArtifactId, artifact.id),
      ),
    );

  return c.json({
    policy: {
      rawArtifactsIncluded: false,
      scope: "memory:read",
    },
    artifact: formatArtifactDetail(artifact, memoryFragment, candidateCountRow?.count ?? 0),
  });
}

export async function handleArtifactPrivacyCheck(
  c: Context<AuthEnv>,
  deps: AppDependencies,
  { twinId, artifact }: { twinId: string; artifact: typeof sourceArtifacts.$inferSelect },
) {
  const { db } = deps;
  const artifactId = artifact.id;
  const { memoryFragment, candidateRows, reflectionRows } = await loadArtifactPrivacyRows(
    db,
    twinId,
    artifactId,
  );
  const { metadata, ciphertextSha256, checklist } = buildArtifactPrivacyChecklist(
    artifact,
    memoryFragment,
    candidateRows,
    reflectionRows,
  );

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
}

export async function handleArtifactEvents(
  c: Context<AuthEnv>,
  deps: AppDependencies,
  { twinId, artifact }: { twinId: string; artifact: typeof sourceArtifacts.$inferSelect },
) {
  const { artifactStatusSubscriber } = deps;
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
      artifact.id,
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
}

async function completeArtifactUpload(
  c: Context<AuthEnv>,
  deps: AppDependencies,
  input: {
    auth: AuthorizedTwin["auth"];
    twinId: string;
    parsedInput: ParsedArtifactUploadInput;
    stored: StoredPrivateMemory;
  },
) {
  const artifact = await insertCreatedArtifact(deps, input);
  const { processingJobId, warning } = await enqueueCreatedArtifactProcessing(deps, {
    twinId: input.twinId,
    artifactId: artifact.id,
    sourceType: input.parsedInput.sourceType,
    stored: input.stored,
  });

  return c.json(
    {
      artifactId: artifact.id,
      memoryFragmentId: null,
      status: artifact.ingestionStatus,
      storageMode: ENCRYPTED_WALRUS_STORAGE_MODE,
      sensitivity: DEFAULT_MANUAL_MEMORY_SENSITIVITY,
      rawStorageRef: input.stored.rawStorageRef,
      processingJobId,
      warning,
    },
    201,
  );
}

async function insertCreatedArtifact(
  deps: AppDependencies,
  input: {
    auth: AuthorizedTwin["auth"];
    twinId: string;
    parsedInput: ParsedArtifactUploadInput;
    stored: StoredPrivateMemory;
  },
) {
  const { db } = deps;
  const artifact = await insertQueuedSourceArtifact({
    db,
    twinId: input.twinId,
    sourceType: input.parsedInput.sourceType,
    storageMetadata: input.parsedInput.storageMetadata,
    stored: input.stored,
    hash: input.parsedInput.aiChatImportFingerprint?.hash,
  });

  await db.insert(auditEvents).values({
    twinId: input.twinId,
    actorType: input.auth.type,
    actorId: input.auth.sub,
    eventType: "artifact.created",
    resourceType: "source_artifact",
    resourceId: artifact.id,
    metadata: {
      memoryFragmentId: null,
      walletAddress: input.auth.walletAddress,
      storageMode: ENCRYPTED_WALRUS_STORAGE_MODE,
      sensitivity: DEFAULT_MANUAL_MEMORY_SENSITIVITY,
      rawStorageRef: input.stored.rawStorageRef,
    },
  });

  return artifact;
}

async function enqueueCreatedArtifactProcessing(
  deps: AppDependencies,
  input: {
    twinId: string;
    artifactId: string;
    sourceType: string;
    stored: StoredPrivateMemory;
  },
) {
  return enqueueArtifactProcessingJob({
    db: deps.db,
    artifactProcessingQueue: deps.artifactProcessingQueue,
    twinId: input.twinId,
    artifactId: input.artifactId,
    sourceType: input.sourceType,
    ...(input.stored.encryptedBytesBase64 && shouldAttachTransientCiphertextBase64(input.stored.encryptedBytesBase64)
      ? {
          transientCiphertext: {
            base64: input.stored.encryptedBytesBase64,
            sha256: input.stored.ciphertextSha256,
          },
        }
      : {}),
  });
}
