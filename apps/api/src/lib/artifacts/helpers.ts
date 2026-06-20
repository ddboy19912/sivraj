import {
  auditEvents,
  candidateMemories,
  memoryFragments,
  reflectionRuns,
  sourceArtifacts,
} from "@sivraj/db";
import { WalrusStorageError } from "@sivraj/storage-walrus";
import { and, eq } from "drizzle-orm";
import type { AppDependencies, SupportedArtifactSourceType } from "../../app.js";
import {
  metadataContainsPlaintextLikeFields,
  readIntelligenceMetadata,
  readIntelligenceStatus,
  readProcessingMetadata,
  readProcessingReason,
  recordMetadata,
  sanitizeSafeMetadata,
} from "../safe-metadata.js";
import {
  computeAiChatImportFingerprint,
  detectAiChatImportMetadata,
} from "./ai-chat-fingerprint.js";
import {
  buildArtifactStorageMetadata,
  readArtifactUploadFields,
  validateArtifactUploadFields,
} from "./upload-input.js";
import {
  loadPrimaryMemoryFragment,
  optionalString,
  readBodyEncryptedPayload,
  sha256Hex,
  type StoredPrivateMemory,
} from "../http/route-helpers.js";
import type { AuthorizedTwin } from "../http/route-auth.js";

const DEFAULT_TRANSIENT_CIPHERTEXT_MAX_BYTES = 2 * 1024 * 1024;

export type ArtifactUploadValidationError = {
  error: {
    status: 400;
    body: Record<string, unknown>;
  };
};

export type ParsedArtifactUploadInput = ReturnType<typeof readArtifactUploadFields> & {
  sourceType: SupportedArtifactSourceType;
  storageMetadata: ReturnType<typeof buildArtifactStorageMetadata>;
  contentFingerprint: ReturnType<typeof buildManualArtifactContentFingerprint>;
  aiChatImportMetadata: Record<string, unknown>;
  aiChatImportFingerprint: ReturnType<typeof computeAiChatImportFingerprint>;
};

export function isArtifactUploadValidationError(
  parsed: ParsedArtifactUploadInput | ArtifactUploadValidationError,
): parsed is ArtifactUploadValidationError {
  return "error" in parsed;
}

export function parseArtifactUploadInput(
  body: Record<string, unknown>,
): ParsedArtifactUploadInput | ArtifactUploadValidationError {
  const fields = readArtifactUploadFields(body);
  const validationError = validateArtifactUploadFields({
    sourceType: fields.sourceType,
    rawSourceType: body["sourceType"],
    encryptedPayload: fields.encryptedPayload,
    content: fields.content,
  });

  if (validationError) {
    return validationError;
  }

  const sourceType = fields.sourceType as SupportedArtifactSourceType;
  const contentFingerprint = buildManualArtifactContentFingerprint({
    sourceType,
    content: fields.content,
    contentSha256: fields.contentSha256,
  });
  const aiChatImportMetadata = sourceType === "chat_export"
    ? detectAiChatImportMetadata({
        content: fields.content ?? "",
        metadata: fields.privateMetadata,
        title: fields.title,
      })
    : {};
  const aiChatImportFingerprint = sourceType === "chat_export"
    ? computeAiChatImportFingerprint({
        content: fields.content ?? "",
        metadata: fields.privateMetadata,
        provider: optionalString(aiChatImportMetadata["aiChatProvider"]),
      })
    : null;

  return {
    ...fields,
    sourceType,
    storageMetadata: buildArtifactStorageMetadata({
      safeUploadMetadata: fields.safeUploadMetadata,
      aiChatImportMetadata,
      aiChatImportFingerprint,
      encryptedPayload: fields.encryptedPayload,
    }),
    contentFingerprint,
    aiChatImportMetadata,
    aiChatImportFingerprint,
  };
}

export function buildManualArtifactContentFingerprint(input: {
  sourceType: SupportedArtifactSourceType;
  content: string | null;
  contentSha256: string | null;
}) {
  const contentSha256 = input.content
    ? sha256Hex(input.content)
    : input.contentSha256;

  if (!contentSha256) {
    return null;
  }

  return {
    hash: sha256Hex(`manual-artifact:v1:${input.sourceType}:${contentSha256}`),
    contentSha256,
    version: 1,
  };
}

export async function storeArtifactUpload(
  privateMemoryStorage: NonNullable<AppDependencies["privateMemoryStorage"]>,
  input: {
    twinId: string;
    sourceType: SupportedArtifactSourceType;
    title: string | null;
    content: string | null;
    encryptedPayload: ReturnType<typeof readBodyEncryptedPayload>;
    privateMetadata: Record<string, unknown>;
  },
): Promise<{ ok: true; value: StoredPrivateMemory } | { ok: false; error: Record<string, unknown> }> {
  try {
    const stored = await (input.encryptedPayload && input.encryptedPayload !== "invalid"
      ? privateMemoryStorage.storeEncryptedPrivateMemory({
          twinId: input.twinId,
          sourceType: input.sourceType,
          encryptedBytes: input.encryptedPayload.encryptedBytes,
          ciphertextSha256: input.encryptedPayload.ciphertextSha256,
          seal: input.encryptedPayload.seal,
        })
      : privateMemoryStorage.storePrivateMemory({
          twinId: input.twinId,
          sourceType: input.sourceType,
          title: input.title,
          content: input.content ?? "",
          metadata: input.privateMetadata,
        }));

    return { ok: true, value: stored };
  } catch (error) {
    console.error("private memory storage failed", {
      error,
      storageErrorCode: error instanceof WalrusStorageError ? error.code : null,
    });

    return { ok: false, error: storageFailureResponse(error) };
  }
}

export function formatArtifactDetail(
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

export async function enqueueArtifactRetryJob(input: {
  db: AppDependencies["db"];
  artifactProcessingQueue: AppDependencies["artifactProcessingQueue"];
  twinId: string;
  artifactId: string;
  sourceType: string;
}) {
  if (!input.artifactProcessingQueue) {
    return {
      processingJobId: null,
      warning: "artifact_processing_queue_not_configured",
    };
  }

  const queued = await input.artifactProcessingQueue
    .enqueueArtifactProcessing({
      artifactId: input.artifactId,
      twinId: input.twinId,
      sourceType: input.sourceType,
      jobKey: `retry-${Date.now()}`,
    })
    .catch(async (error: unknown) => {
      console.error("artifact retry queue enqueue failed", error);

      await input.db.insert(auditEvents).values({
        twinId: input.twinId,
        actorType: "system",
        actorId: "sivraj-api",
        eventType: "artifact.retry_queue_failed",
        resourceType: "source_artifact",
        resourceId: input.artifactId,
        metadata: {
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

export function shouldAttachTransientCiphertextBase64(ciphertextBase64: string): boolean {
  const maxBytes = readTransientCiphertextMaxBytes(process.env["TRANSIENT_CIPHERTEXT_MAX_BYTES"]);
  const approximateBytes = Math.ceil((ciphertextBase64.length * 3) / 4);

  return maxBytes > 0 && approximateBytes <= maxBytes;
}

export function isStreamTerminal(
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

export async function loadArtifactPrivacyRows(
  db: AppDependencies["db"],
  twinId: string,
  artifactId: string,
) {
  const memoryFragment = await loadPrimaryMemoryFragment(db, twinId, artifactId);

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

  return { memoryFragment, candidateRows, reflectionRows };
}

export function buildArtifactPrivacyChecklist(
  artifact: typeof sourceArtifacts.$inferSelect,
  memoryFragment: typeof memoryFragments.$inferSelect | null,
  candidateRows: Array<{ statementStorageRef: string | null }>,
  reflectionRows: Array<{ summaryStorageRef: string | null }>,
) {
  const metadata = recordMetadata(artifact.metadata);
  const ciphertextSha256 = optionalString(metadata["ciphertextSha256"]);

  return {
    metadata,
    ciphertextSha256,
    checklist: {
      sourceArtifactHasRawStorageRef: Boolean(artifact.rawStorageRef),
      sourceArtifactHasCiphertextHash: Boolean(ciphertextSha256),
      sourceArtifactMetadataHasNoPlaintextFields: !metadataContainsPlaintextLikeFields(metadata),
      memoryFragmentHasContentStorageRef: Boolean(memoryFragment?.contentStorageRef),
      candidateMemoriesUseStatementStorageRef: candidateRows.every((row) => Boolean(row.statementStorageRef)),
      completedReflectionsUseSummaryStorageRef: reflectionRows.every((row) => Boolean(row.summaryStorageRef)),
    },
  };
}

export async function updateArtifactForRetry(
  db: AppDependencies["db"],
  artifactStatusPublisher: AppDependencies["artifactStatusPublisher"],
  input: {
    auth: AuthorizedTwin["auth"];
    twinId: string;
    artifact: typeof sourceArtifacts.$inferSelect;
  },
) {
  const artifactId = input.artifact.id;
  const retryMetadata = {
    ...recordMetadata(input.artifact.metadata),
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
        eq(sourceArtifacts.twinId, input.twinId),
      ),
    )
    .returning();

  await artifactStatusPublisher?.publishArtifactStatus({
    artifactId,
    twinId: input.twinId,
    sourceType: input.artifact.sourceType,
    status: "queued",
    reason: "retry_requested",
    occurredAt: new Date().toISOString(),
  });

  await db.insert(auditEvents).values({
    twinId: input.twinId,
    actorType: input.auth.type,
    actorId: input.auth.sub,
    eventType: "artifact.retry_requested",
    resourceType: "source_artifact",
    resourceId: artifactId,
    metadata: {
      previousStatus: input.artifact.ingestionStatus,
      sourceType: input.artifact.sourceType,
    },
  });

  return retried;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown queue error";
}

function storageFailureResponse(error: unknown) {
  if (error instanceof WalrusStorageError && error.code === "walrus_insufficient_balance") {
    const coinSymbol = error.storageWallet?.coinSymbol ?? "SUI/WAL";
    return {
      error: "storage_wallet_insufficient_balance",
      message: `Private memory storage needs more ${coinSymbol} before it can save this memory.`,
      ...(error.storageWallet ? { storageWallet: error.storageWallet } : {}),
    };
  }

  return { error: "encrypted_storage_failed" };
}

function readTransientCiphertextMaxBytes(value: string | undefined): number {
  if (!value) {
    return DEFAULT_TRANSIENT_CIPHERTEXT_MAX_BYTES;
  }

  const parsed = Number.parseInt(value, 10);

  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_TRANSIENT_CIPHERTEXT_MAX_BYTES;
}
