import {
  DEFAULT_MANUAL_MEMORY_SENSITIVITY,
  ENCRYPTED_WALRUS_STORAGE_MODE,
} from "@sivraj/core";
import { auditEvents, candidateMemories, chatThreads, memoryFragments, sourceArtifacts } from "@sivraj/db";
import { and, count, desc, eq, inArray, ne, sql } from "drizzle-orm";
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import type { AppDependencies } from "../app.js";
import {
  recordMetadata,
  readIntelligenceStatus,
  readProcessingMetadata,
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
  readQueryLimit,
  type StoredPrivateMemory,
} from "../lib/http/route-helpers.js";

const RETRYABLE_FILE_SOURCE_TYPES = [
  "upload",
  "url",
  "pdf",
  "ocr_pdf",
  "markdown",
  "docx",
  "csv",
  "image",
] as const;

type FailedArtifactRetryResult = {
  artifactId: string;
  sourceType: string;
  status: (typeof sourceArtifacts.$inferSelect)["ingestionStatus"];
  retried: boolean;
  processingJobId?: string | null;
  warning?: string | null;
  reason?: string;
};

export function isRetryableFileSourceType(sourceType: string) {
  return (RETRYABLE_FILE_SOURCE_TYPES as readonly string[]).includes(sourceType);
}

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

  const duplicateArtifactResponse = await findDuplicateManualArtifact(c, deps, {
    auth,
    twinId,
    parsedInput,
  });

  if (duplicateArtifactResponse) {
    return duplicateArtifactResponse;
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

async function findDuplicateManualArtifact(
  c: Context<AuthEnv>,
  deps: AppDependencies,
  input: {
    auth: AuthorizedTwin["auth"];
    twinId: string;
    parsedInput: ParsedArtifactUploadInput;
  },
) {
  const fingerprint = input.parsedInput.contentFingerprint;

  if (!fingerprint) {
    return null;
  }

  const [duplicateArtifact] = await deps.db
    .select()
    .from(sourceArtifacts)
    .where(and(
      eq(sourceArtifacts.twinId, input.twinId),
      eq(sourceArtifacts.sourceType, input.parsedInput.sourceType),
      eq(sourceArtifacts.hash, fingerprint.hash),
      ne(sourceArtifacts.ingestionStatus, "failed"),
    ))
    .orderBy(desc(sourceArtifacts.createdAt))
    .limit(1);

  if (!duplicateArtifact) {
    return null;
  }

  const duplicateMemoryFragment = await loadPrimaryMemoryFragment(
    deps.db,
    input.twinId,
    duplicateArtifact.id,
  );

  if (!isReusableDuplicateArtifact(duplicateArtifact, duplicateMemoryFragment)) {
    await deps.db.insert(auditEvents).values({
      twinId: input.twinId,
      actorType: input.auth.type,
      actorId: input.auth.sub,
      eventType: "artifact.duplicate_ignored_unreadable",
      resourceType: "source_artifact",
      resourceId: duplicateArtifact.id,
      metadata: {
        reason: "duplicate_artifact_storage_unreadable",
        sourceType: input.parsedInput.sourceType,
        ingestionStatus: duplicateArtifact.ingestionStatus,
        storageStatus: duplicateMemoryFragment?.storageStatus ?? null,
        storageLastReadErrorCode: duplicateMemoryFragment?.storageLastReadErrorCode ?? null,
        contentFingerprintVersion: fingerprint.version,
        walletAddress: input.auth.walletAddress,
      },
    });
    return null;
  }

  await updateUploadedArtifactThreadFocus(deps, {
    twinId: input.twinId,
    artifact: duplicateArtifact,
    metadata: input.parsedInput.storageMetadata,
  });

  await deps.db.insert(auditEvents).values({
    twinId: input.twinId,
    actorType: input.auth.type,
    actorId: input.auth.sub,
    eventType: "artifact.skipped_duplicate",
    resourceType: "source_artifact",
    resourceId: duplicateArtifact.id,
    metadata: {
      reason: "duplicate_artifact_upload",
      sourceType: input.parsedInput.sourceType,
      contentFingerprintVersion: fingerprint.version,
      walletAddress: input.auth.walletAddress,
    },
  });

  return c.json({
    artifactId: duplicateArtifact.id,
    duplicateOfArtifactId: duplicateArtifact.id,
    memoryFragmentId: null,
    status: duplicateArtifact.ingestionStatus,
    storageMode: ENCRYPTED_WALRUS_STORAGE_MODE,
    sensitivity: DEFAULT_MANUAL_MEMORY_SENSITIVITY,
    rawStorageRef: duplicateArtifact.rawStorageRef,
    skipped: true,
    reason: "duplicate_artifact_upload",
  });
}

export function isReusableDuplicateArtifact(
  artifact: Pick<typeof sourceArtifacts.$inferSelect, "ingestionStatus">,
  memoryFragment: Pick<typeof memoryFragments.$inferSelect, "storageStatus"> | null,
) {
  if (
    artifact.ingestionStatus === "pending" ||
    artifact.ingestionStatus === "queued" ||
    artifact.ingestionStatus === "processing"
  ) {
    return true;
  }

  if (artifact.ingestionStatus !== "completed") {
    return false;
  }

  return memoryFragment?.storageStatus === "verified_available" ||
    memoryFragment?.storageStatus === "renewed" ||
    memoryFragment?.storageStatus === "expiring_soon" ||
    memoryFragment?.storageStatus === "renewing";
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

export async function handleArtifactRetryFailed(
  c: Context<AuthEnv>,
  deps: AppDependencies,
  { auth, twinId }: { auth: AuthorizedTwin["auth"]; twinId: string },
) {
  const { db, artifactProcessingQueue } = deps;
  const limit = readQueryLimit(c.req.query("limit"), 50, 200);
  const artifacts = await db
    .select()
    .from(sourceArtifacts)
    .where(and(
      eq(sourceArtifacts.twinId, twinId),
      eq(sourceArtifacts.ingestionStatus, "failed"),
      inArray(sourceArtifacts.sourceType, [...RETRYABLE_FILE_SOURCE_TYPES]),
    ))
    .orderBy(desc(sourceArtifacts.updatedAt))
    .limit(limit);

  const results: FailedArtifactRetryResult[] = [];
  for (const artifact of artifacts) {
    if (!artifact.rawStorageRef) {
      results.push({
        artifactId: artifact.id,
        sourceType: artifact.sourceType,
        status: artifact.ingestionStatus,
        retried: false,
        reason: "artifact_source_storage_missing",
      });
      continue;
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

    results.push({
      artifactId: retried?.id ?? artifact.id,
      sourceType: artifact.sourceType,
      status: retried?.ingestionStatus ?? "queued",
      retried: true,
      processingJobId: queueResult.processingJobId,
      warning: queueResult.warning,
    });
  }

  const retriedCount = results.filter((result) => result.retried).length;
  const skippedCount = results.length - retriedCount;
  const warningCount = results.reduce(
    (sum, result) => sum + (result.warning ? 1 : 0),
    0,
  );

  await db.insert(auditEvents).values({
    twinId,
    actorType: auth.type,
    actorId: auth.sub,
    eventType: "artifact.failed_retries_requested",
    resourceType: "twin",
    resourceId: twinId,
    metadata: {
      limit,
      matchedCount: artifacts.length,
      retriedCount,
      skippedCount,
      warningCount,
      sourceTypes: RETRYABLE_FILE_SOURCE_TYPES,
    },
  });

  return c.json({
    limit,
    matchedCount: artifacts.length,
    retriedCount,
    skippedCount,
    warningCount,
    results,
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

export async function handleArtifactList(
  c: Context<AuthEnv>,
  deps: AppDependencies,
  { auth, twinId }: { auth: AuthorizedTwin["auth"]; twinId: string },
) {
  const { db } = deps;
  const kind = readArtifactListKind(c.req.query("kind"));
  const limit = readArtifactListLimit(c.req.query("limit"));
  const filters = [
    eq(sourceArtifacts.twinId, twinId),
    ...(kind === "agent_instructions"
      ? [sql`${sourceArtifacts.metadata}->>'engineeringSourceKind' = 'agent_instruction_file'`]
      : []),
  ];
  const artifactRows = await db
    .select()
    .from(sourceArtifacts)
    .where(and(...filters))
    .orderBy(desc(sourceArtifacts.createdAt))
    .limit(limit);
  const candidateRows = artifactRows.length === 0
    ? []
    : await db
      .select({
        id: candidateMemories.id,
        sourceArtifactId: candidateMemories.sourceArtifactId,
        metadata: candidateMemories.metadata,
      })
      .from(candidateMemories)
      .where(and(
        eq(candidateMemories.twinId, twinId),
        inArray(candidateMemories.sourceArtifactId, artifactRows.map((artifact) => artifact.id)),
      ));
  const candidatesByArtifact = groupCandidateRowsByArtifact(candidateRows);

  await db.insert(auditEvents).values({
    twinId,
    actorType: auth.type,
    actorId: auth.sub,
    eventType: "artifact.sources_listed",
    resourceType: "twin",
    resourceId: twinId,
    metadata: {
      kind,
      limit,
      resultCount: artifactRows.length,
      rawArtifactsIncluded: false,
    },
  });

  return c.json({
    policy: {
      rawArtifactsIncluded: false,
      exactContentEndpoint: true,
      scope: "memory:read",
    },
    kind,
    sources: artifactRows.map((artifact) =>
      formatArtifactSourceSummary(artifact, candidatesByArtifact.get(artifact.id) ?? []),
    ),
    summary: {
      sourceCount: artifactRows.length,
      agentInstructionSourceCount: artifactRows.filter(isAgentInstructionArtifact).length,
      exactContentAvailableCount: artifactRows.filter((artifact) => Boolean(artifact.rawStorageRef)).length,
    },
  });
}

export async function handleArtifactPreview(
  c: Context<AuthEnv>,
  deps: AppDependencies,
  { twinId, artifact }: { twinId: string; artifact: typeof sourceArtifacts.$inferSelect },
) {
  if (!deps.privateMemoryReader) {
    return c.json({ error: "encrypted_storage_reader_not_configured" }, 503);
  }

  if (!artifact.rawStorageRef) {
    return c.json({ error: "artifact_content_unavailable" }, 404);
  }

  const metadata = recordMetadata(artifact.metadata);
  const payload = await deps.privateMemoryReader.readPrivateMemory({
    rawStorageRef: artifact.rawStorageRef,
    artifactId: artifact.id,
    twinId,
    expectedCiphertextSha256: optionalString(metadata["ciphertextSha256"]),
  }).then(readPrivateSourcePayload).catch((error: unknown) => {
    console.warn("artifact preview decrypt failed", {
      artifactId: artifact.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  });

  if (!payload) {
    return c.json({ error: "artifact_preview_unavailable" }, 503);
  }

  const preview = decodePreviewContent(payload.content, artifact.sourceType);
  if (!preview) {
    return c.json({ error: "artifact_preview_unsupported" }, 415);
  }

  const fileName = safePreviewFileName(
    optionalString(payload.metadata["fileName"]) ??
      payload.title ??
      optionalString(metadata["fileName"]) ??
      artifact.sourceType,
  );

  const body = new ArrayBuffer(preview.bytes.byteLength);
  new Uint8Array(body).set(preview.bytes);

  return new Response(body, {
    headers: {
      "content-type": preview.contentType,
      "content-disposition": `inline; filename="${fileName}"`,
      "cache-control": "private, max-age=60",
    },
  });
}

export async function handleArtifactContent(
  c: Context<AuthEnv>,
  deps: AppDependencies,
  { auth, twinId, artifact }: { auth: AuthorizedTwin["auth"]; twinId: string; artifact: typeof sourceArtifacts.$inferSelect },
) {
  if (!deps.privateMemoryReader) {
    return c.json({ error: "encrypted_storage_reader_not_configured" }, 503);
  }

  if (!artifact.rawStorageRef) {
    return c.json({ error: "artifact_content_unavailable" }, 404);
  }

  const payload = await readArtifactPrivateSourcePayload(deps, {
    artifact,
    twinId,
  });

  if (!payload) {
    return c.json({ error: "artifact_content_unavailable" }, 503);
  }

  await deps.db.insert(auditEvents).values({
    twinId,
    actorType: auth.type,
    actorId: auth.sub,
    eventType: "artifact.content_read",
    resourceType: "source_artifact",
    resourceId: artifact.id,
    metadata: {
      sourceType: artifact.sourceType,
      rawArtifactsIncluded: true,
      contentLength: payload.content.length,
    },
  });

  return c.json(buildArtifactContentResponse(artifact, payload));
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
    processing: readProcessingMetadata(artifact.metadata),
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
  await updateUploadedArtifactThreadFocus(deps, {
    twinId: input.twinId,
    artifact,
    metadata: input.parsedInput.storageMetadata,
  });
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
    hash: input.parsedInput.aiChatImportFingerprint?.hash ??
      input.parsedInput.contentFingerprint?.hash,
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

async function updateUploadedArtifactThreadFocus(
  deps: AppDependencies,
  input: {
    twinId: string;
    artifact: typeof sourceArtifacts.$inferSelect;
    metadata: Record<string, unknown>;
  },
) {
  if (!isDocumentSourceType(input.artifact.sourceType)) {
    return;
  }

  const threadId = optionalString(input.metadata["threadId"]);
  if (!threadId) {
    return;
  }

  const [thread] = await deps.db
    .select()
    .from(chatThreads)
    .where(and(
      eq(chatThreads.id, threadId),
      eq(chatThreads.twinId, input.twinId),
    ))
    .limit(1);

  if (!thread) {
    return;
  }

  await deps.db
    .update(chatThreads)
    .set({
      metadata: {
        ...recordMetadata(thread.metadata),
        documentFocus: {
          sourceArtifactId: input.artifact.id,
          sourceType: input.artifact.sourceType,
          reason: "chat_upload",
          updatedAt: new Date().toISOString(),
        },
      },
      updatedAt: new Date(),
    })
    .where(and(
      eq(chatThreads.id, thread.id),
      eq(chatThreads.twinId, input.twinId),
    ));
}

function isDocumentSourceType(sourceType: string) {
  return sourceType === "pdf" ||
    sourceType === "ocr_pdf" ||
    sourceType === "docx" ||
    sourceType === "markdown" ||
    sourceType === "upload" ||
    sourceType === "url" ||
    sourceType === "image";
}

async function readArtifactPrivateSourcePayload(
  deps: AppDependencies,
  input: {
    artifact: typeof sourceArtifacts.$inferSelect;
    twinId: string;
  },
): Promise<{
  title: string | null;
  content: string;
  metadata: Record<string, unknown>;
} | null> {
  if (!deps.privateMemoryReader || !input.artifact.rawStorageRef) {
    return null;
  }

  const metadata = recordMetadata(input.artifact.metadata);

  return deps.privateMemoryReader.readPrivateMemory({
    rawStorageRef: input.artifact.rawStorageRef,
    artifactId: input.artifact.id,
    twinId: input.twinId,
    expectedCiphertextSha256: optionalString(metadata["ciphertextSha256"]),
  }).then(readPrivateSourcePayload).catch((error: unknown) => {
    console.warn("artifact source decrypt failed", {
      artifactId: input.artifact.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  });
}

function readPrivateSourcePayload(value: string): {
  title: string | null;
  content: string;
  metadata: Record<string, unknown>;
} | null {
  const parsed = JSON.parse(value) as unknown;
  const record = recordMetadata(parsed);

  if (
    record["kind"] !== "source_artifact" ||
    typeof record["content"] !== "string"
  ) {
    return null;
  }

  return {
    title: optionalString(record["title"]),
    content: record["content"],
    metadata: recordMetadata(record["metadata"]),
  };
}

export function buildArtifactContentResponse(
  artifact: typeof sourceArtifacts.$inferSelect,
  payload: {
    title: string | null;
    content: string;
    metadata: Record<string, unknown>;
  },
) {
  const artifactMetadata = recordMetadata(artifact.metadata);
  const preview = decodePreviewContent(payload.content, artifact.sourceType);
  const dataUrl = parseDataUrl(payload.content);
  const fileName = safePreviewFileName(
    optionalString(payload.metadata["fileName"]) ??
      optionalString(artifactMetadata["sourceDisplayName"]) ??
      optionalString(artifactMetadata["agentInstructionFileName"]) ??
      optionalString(artifactMetadata["targetInstructionFile"]) ??
      payload.title ??
      artifact.sourceType,
  );

  return {
    policy: {
      rawArtifactsIncluded: true,
      decryptedSourceIncluded: true,
      scope: "memory:read",
    },
    artifact: {
      id: artifact.id,
      sourceType: artifact.sourceType,
      ingestionStatus: artifact.ingestionStatus,
      fileName,
      title: payload.title,
      contentType: preview?.contentType ?? contentTypeForTextSource(artifact.sourceType),
      encoding: dataUrl ? "data_url" : "text",
      byteLength: preview?.bytes.byteLength ?? new TextEncoder().encode(payload.content).byteLength,
      metadata: sanitizeSafeMetadata({
        ...artifactMetadata,
        ...safePrivatePayloadSourceMetadata(payload.metadata),
      }),
      createdAt: artifact.createdAt.toISOString(),
      updatedAt: artifact.updatedAt.toISOString(),
    },
    content: payload.content,
  };
}

export function formatArtifactSourceSummary(
  artifact: typeof sourceArtifacts.$inferSelect,
  candidates: Array<{
    id: string;
    metadata: unknown;
  }>,
) {
  const metadata = recordMetadata(artifact.metadata);
  const engineeringCandidateCount = candidates.filter((candidate) =>
    recordMetadata(candidate.metadata)["engineering"] === true,
  ).length;
  const sourceKind = optionalString(metadata["engineeringSourceKind"]) ??
    optionalString(metadata["sourceKind"]) ??
    sourceKindForArtifact(artifact);
  const targetInstructionFile = optionalString(metadata["targetInstructionFile"]);
  const agentInstructionFileName = optionalString(metadata["agentInstructionFileName"]);

  return {
    artifactId: artifact.id,
    sourceType: artifact.sourceType,
    sourceKind,
    displayName: displayNameForArtifactSource({
      artifact,
      metadata,
      targetInstructionFile,
      agentInstructionFileName,
    }),
    targetInstructionFile,
    agentInstructionFileName,
    ingestionStatus: artifact.ingestionStatus,
    intelligenceStatus: readIntelligenceStatus(artifact.metadata) ?? null,
    processing: readProcessingMetadata(artifact.metadata),
    exactContentAvailable: Boolean(artifact.rawStorageRef),
    candidateMemoryCount: candidates.length,
    engineeringMemoryCount: engineeringCandidateCount,
    metadata: sanitizeSafeMetadata(metadata),
    createdAt: artifact.createdAt.toISOString(),
    updatedAt: artifact.updatedAt.toISOString(),
  };
}

function groupCandidateRowsByArtifact<T extends { sourceArtifactId: string }>(rows: T[]) {
  const groups = new Map<string, T[]>();

  for (const row of rows) {
    groups.set(row.sourceArtifactId, [...(groups.get(row.sourceArtifactId) ?? []), row]);
  }

  return groups;
}

function readArtifactListKind(value: string | undefined): "all" | "agent_instructions" {
  return value === "agent_instructions" ? "agent_instructions" : "all";
}

function readArtifactListLimit(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "80", 10);

  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 200) : 80;
}

function isAgentInstructionArtifact(artifact: typeof sourceArtifacts.$inferSelect) {
  return recordMetadata(artifact.metadata)["engineeringSourceKind"] === "agent_instruction_file";
}

function sourceKindForArtifact(artifact: typeof sourceArtifacts.$inferSelect) {
  if (isAgentInstructionArtifact(artifact)) {
    return "agent_instruction_file";
  }

  return artifact.sourceType;
}

function displayNameForArtifactSource(input: {
  artifact: typeof sourceArtifacts.$inferSelect;
  metadata: Record<string, unknown>;
  targetInstructionFile: string | null;
  agentInstructionFileName: string | null;
}) {
  return optionalString(input.metadata["sourceDisplayName"]) ??
    input.targetInstructionFile ??
    input.agentInstructionFileName ??
    optionalString(input.metadata["aiChatProvider"]) ??
    `${formatSourceType(input.artifact.sourceType)} source`;
}

function safePrivatePayloadSourceMetadata(metadata: Record<string, unknown>) {
  const safeKeys = [
    "agentInstructionFileName",
    "targetInstructionFile",
    "agentInstructionOrigin",
    "engineeringSourceKind",
    "artifactPurpose",
    "uploadSurface",
  ];

  return Object.fromEntries(
    safeKeys.flatMap((key) => (
      metadata[key] === undefined ? [] : [[key, metadata[key]]]
    )),
  );
}

function contentTypeForTextSource(sourceType: string) {
  if (sourceType === "markdown") {
    return "text/markdown; charset=utf-8";
  }

  if (sourceType === "chat_export") {
    return "application/json; charset=utf-8";
  }

  return "text/plain; charset=utf-8";
}

function decodePreviewContent(
  content: string,
  sourceType: string,
): { bytes: Uint8Array; contentType: string } | null {
  const dataUrl = parseDataUrl(content);
  if (dataUrl) {
    return dataUrl;
  }

  if (sourceType === "markdown") {
    return {
      bytes: new TextEncoder().encode(content),
      contentType: "text/markdown; charset=utf-8",
    };
  }

  if (sourceType === "upload") {
    return {
      bytes: new TextEncoder().encode(content),
      contentType: "text/plain; charset=utf-8",
    };
  }

  return null;
}

function formatSourceType(value: string) {
  return value
    .replace(/[_-]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/\S+/gu, (word) =>
      word.length <= 2
        ? word.toUpperCase()
        : `${word.slice(0, 1).toUpperCase()}${word.slice(1).toLowerCase()}`,
    );
}

function parseDataUrl(value: string): { bytes: Uint8Array; contentType: string } | null {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/su.exec(value);
  if (!match) {
    return null;
  }

  const contentType = match[1] || "application/octet-stream";
  const isBase64 = Boolean(match[2]);
  const encoded = match[3] ?? "";
  const bytes = isBase64
    ? Uint8Array.from(Buffer.from(encoded, "base64"))
    : new TextEncoder().encode(decodeURIComponent(encoded));

  return { bytes, contentType };
}

function safePreviewFileName(value: string): string {
  const cleaned = value
    .replace(/["\r\n]/gu, "")
    .replace(/[\/\\]/gu, "_")
    .trim();

  return cleaned || "artifact";
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
