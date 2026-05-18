export type IngestionStatus = "pending" | "queued" | "processing" | "completed" | "failed" | "cancelled";

export type QueuedArtifact = {
  id: string;
  twinId: string;
  sourceType: string;
  title: string | null;
  rawStorageRef: string | null;
  metadata: unknown;
};

export type ArtifactRepository = {
  findQueuedArtifacts(limit: number): Promise<QueuedArtifact[]>;
  claimArtifact(id: string): Promise<QueuedArtifact | null>;
  claimRecoverableArtifact(id: string): Promise<QueuedArtifact | null>;
  markArtifactPending(id: string, metadata: Record<string, unknown>): Promise<void>;
  markArtifactCompleted(id: string, metadata: Record<string, unknown>): Promise<void>;
  markArtifactFailed(id: string, metadata: Record<string, unknown>): Promise<void>;
  findMemoryFragmentBySourceArtifactId(sourceArtifactId: string): Promise<{ id: string } | null>;
  createMemoryFragment(input: {
    twinId: string;
    sourceArtifactId: string;
    content: string;
    summary: string | null;
    importanceScore: number;
    confidenceScore: number;
  }): Promise<{ id: string }>;
  createAuditEvent(input: {
    twinId: string;
    eventType: string;
    resourceId: string;
    metadata: Record<string, unknown>;
  }): Promise<void>;
};

export type PrivateMemoryReader = {
  readPrivateMemory(input: {
    rawStorageRef: string;
    artifactId: string;
    twinId: string;
  }): Promise<string>;
};

export type ProcessQueuedArtifactsResult = {
  scanned: number;
  completed: number;
  pending: number;
  failed: number;
};

export type ProcessArtifactResult = "completed" | "pending" | "failed" | "skipped";

export const ENCRYPTED_DECRYPTION_REQUIRED = "encrypted_decryption_required";
export const MISSING_PROCESSABLE_CONTENT = "missing_processable_content";
export const ENCRYPTED_DECRYPTION_FAILED = "encrypted_decryption_failed";

export async function processArtifact(
  repository: ArtifactRepository,
  artifactId: string,
  options: { now?: Date; privateMemoryReader?: PrivateMemoryReader } = {},
): Promise<ProcessArtifactResult> {
  const now = options.now ?? new Date();
  const claimed = await repository.claimArtifact(artifactId);

  if (!claimed) {
    return "skipped";
  }

  return processClaimedArtifact(repository, claimed, now, options.privateMemoryReader);
}

export async function recoverArtifact(
  repository: ArtifactRepository,
  artifactId: string,
  options: { now?: Date; privateMemoryReader?: PrivateMemoryReader } = {},
): Promise<ProcessArtifactResult> {
  const now = options.now ?? new Date();
  const claimed = await repository.claimRecoverableArtifact(artifactId);

  if (!claimed) {
    return "skipped";
  }

  return processClaimedArtifact(repository, claimed, now, options.privateMemoryReader);
}

export async function processQueuedArtifacts(
  repository: ArtifactRepository,
  options: { limit?: number; now?: Date; privateMemoryReader?: PrivateMemoryReader } = {},
): Promise<ProcessQueuedArtifactsResult> {
  const limit = options.limit ?? 10;
  const now = options.now ?? new Date();
  const artifacts = await repository.findQueuedArtifacts(limit);
  const result: ProcessQueuedArtifactsResult = {
    scanned: artifacts.length,
    completed: 0,
    pending: 0,
    failed: 0,
  };

  for (const artifact of artifacts) {
    const outcome = await recoverArtifact(repository, artifact.id, {
      now,
      privateMemoryReader: options.privateMemoryReader,
    });

    if (outcome === "skipped") {
      continue;
    }

    result[outcome] += 1;
  }

  return result;
}

async function processClaimedArtifact(
  repository: ArtifactRepository,
  artifact: QueuedArtifact,
  now: Date,
  privateMemoryReader: PrivateMemoryReader | undefined,
): Promise<"completed" | "pending" | "failed"> {
  const metadata = asRecord(artifact.metadata);

  if (isEncryptedPrivateArtifact(metadata)) {
    if (privateMemoryReader && artifact.rawStorageRef) {
      const plaintext = await privateMemoryReader
        .readPrivateMemory({
          rawStorageRef: artifact.rawStorageRef,
          artifactId: artifact.id,
          twinId: artifact.twinId,
        })
        .catch(async (error: unknown) => {
          const nextMetadata = withProcessingState(metadata, {
            status: "failed",
            reason: ENCRYPTED_DECRYPTION_FAILED,
            detail: errorMessage(error),
            processedAt: now.toISOString(),
          });

          await repository.markArtifactFailed(artifact.id, nextMetadata);
          await repository.createAuditEvent({
            twinId: artifact.twinId,
            eventType: "artifact.processing_failed",
            resourceId: artifact.id,
            metadata: {
              reason: ENCRYPTED_DECRYPTION_FAILED,
              rawStorageRef: artifact.rawStorageRef,
            },
          });
          return null;
        });

      if (plaintext === null) {
        return "failed";
      }

      if (plaintext.trim().length > 0) {
        const fragment = await getOrCreateMemoryFragment(repository, {
          twinId: artifact.twinId,
          sourceArtifactId: artifact.id,
          content: plaintext.trim(),
          summary: artifact.title,
          importanceScore: 0.5,
          confidenceScore: 0.7,
        });
        const nextMetadata = withProcessingState(metadata, {
          status: "completed",
          memoryFragmentId: fragment.id,
          processedAt: now.toISOString(),
          decryptPath: "seal_walrus",
        });

        await repository.markArtifactCompleted(artifact.id, nextMetadata);
        await repository.createAuditEvent({
          twinId: artifact.twinId,
          eventType: "artifact.processed",
          resourceId: artifact.id,
          metadata: {
            memoryFragmentId: fragment.id,
            decryptPath: "seal_walrus",
            rawStorageRef: artifact.rawStorageRef,
          },
        });
        return "completed";
      }
    }

    const nextMetadata = withProcessingState(metadata, {
      status: "pending",
      reason: ENCRYPTED_DECRYPTION_REQUIRED,
      detail: "Encrypted private artifacts require a scoped Seal decrypt path before memory fragments can be derived.",
      processedAt: now.toISOString(),
    });

    await repository.markArtifactPending(artifact.id, nextMetadata);
    await repository.createAuditEvent({
      twinId: artifact.twinId,
      eventType: "artifact.processing_pending",
      resourceId: artifact.id,
      metadata: {
        reason: ENCRYPTED_DECRYPTION_REQUIRED,
        rawStorageRef: artifact.rawStorageRef,
      },
    });
    return "pending";
  }

  const plaintext = readPlaintextProcessingInput(metadata);

  if (!plaintext) {
    const nextMetadata = withProcessingState(metadata, {
      status: "failed",
      reason: MISSING_PROCESSABLE_CONTENT,
      detail: "No plaintext processing input was available for this non-encrypted artifact.",
      processedAt: now.toISOString(),
    });

    await repository.markArtifactFailed(artifact.id, nextMetadata);
    await repository.createAuditEvent({
      twinId: artifact.twinId,
      eventType: "artifact.processing_failed",
      resourceId: artifact.id,
      metadata: { reason: MISSING_PROCESSABLE_CONTENT },
    });
    return "failed";
  }

  const fragment = await getOrCreateMemoryFragment(repository, {
    twinId: artifact.twinId,
    sourceArtifactId: artifact.id,
    content: plaintext,
    summary: artifact.title,
    importanceScore: 0.5,
    confidenceScore: 0.6,
  });
  const nextMetadata = withProcessingState(metadata, {
    status: "completed",
    memoryFragmentId: fragment.id,
    processedAt: now.toISOString(),
  });

  await repository.markArtifactCompleted(artifact.id, nextMetadata);
  await repository.createAuditEvent({
    twinId: artifact.twinId,
    eventType: "artifact.processed",
    resourceId: artifact.id,
    metadata: {
      memoryFragmentId: fragment.id,
    },
  });
  return "completed";
}

async function getOrCreateMemoryFragment(
  repository: ArtifactRepository,
  input: Parameters<ArtifactRepository["createMemoryFragment"]>[0],
) {
  const existing = await repository.findMemoryFragmentBySourceArtifactId(input.sourceArtifactId);

  return existing ?? repository.createMemoryFragment(input);
}

function isEncryptedPrivateArtifact(metadata: Record<string, unknown>): boolean {
  return metadata["storageMode"] === "encrypted_walrus" && metadata["sensitivity"] === "private";
}

function readPlaintextProcessingInput(metadata: Record<string, unknown>): string | null {
  const processingInput = asRecord(metadata["processingInput"]);
  const content = processingInput["content"];

  return typeof content === "string" && content.trim().length > 0 ? content.trim() : null;
}

function withProcessingState(
  metadata: Record<string, unknown>,
  processing: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...metadata,
    processing,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown decrypt error";
}
