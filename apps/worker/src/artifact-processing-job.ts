import type { ArtifactProcessingJobData, ArtifactProcessingQueue, ArtifactStatusPublisher } from "@sivraj/queue";

type ArtifactProcessingJob = {
  id?: string;
  attemptsMade: number;
  opts: { attempts?: number };
};
import type { createDrizzleArtifactRepository } from "./repository.js";
import type { createConfiguredPrivateMemoryReader } from "@sivraj/private-memory-reader";
import type { createConfiguredPrivateFragmentStorage } from "./private-fragment-storage.js";
import type {
  createConfiguredSpeechToTextTranscriber,
  createConfiguredStructuredGenerator,
  createConfiguredTextEmbedder,
} from "@sivraj/llm";
import type { createIntelligenceProcessingQueue, createTransientCiphertextCache } from "@sivraj/queue";
import { ENCRYPTED_DECRYPTION_FAILED } from "./ingestion-processor.js";
import type {
  processArtifact,
  RetryableArtifactProcessingError,
} from "./ingestion-processor.js";
import {
  executeArtifactProcessingAttempt,
  isRetryableArtifactJobError,
} from "./artifact-job-runner.js";
import { artifactMetadata } from "./artifact-metadata.js";
import type { Db } from "@sivraj/db";
import { and, eq } from "drizzle-orm";
import { sourceArtifacts } from "@sivraj/db";
import { readIntelligenceStatus, readProcessingReason } from "./artifact-metadata.js";
import {
  shouldDeadLetterArtifactJob,
} from "./artifact-job-outcome.js";

type ArtifactRepository = ReturnType<typeof createDrizzleArtifactRepository>;
type PrivateMemoryReader = ReturnType<typeof createConfiguredPrivateMemoryReader>;
type PrivateFragmentStorage = ReturnType<typeof createConfiguredPrivateFragmentStorage>;
type SpeechToTextTranscriber = ReturnType<typeof createConfiguredSpeechToTextTranscriber>;
type TextEmbedder = ReturnType<typeof createConfiguredTextEmbedder>;
type StructuredGenerator = ReturnType<typeof createConfiguredStructuredGenerator>;
type IntelligenceQueue = ReturnType<typeof createIntelligenceProcessingQueue>;
type TransientCiphertextCache = ReturnType<typeof createTransientCiphertextCache>;

export type ArtifactProcessingJobDeps = {
  serviceName: string;
  repository: ArtifactRepository;
  db: Db;
  privateMemoryReader: PrivateMemoryReader;
  privateFragmentStorage: PrivateFragmentStorage;
  speechToTextTranscriber: SpeechToTextTranscriber | null;
  textEmbedder: TextEmbedder | null;
  structuredGenerator: StructuredGenerator | null;
  intelligenceQueue: IntelligenceQueue;
  transientCiphertextCache: TransientCiphertextCache;
  artifactRetryQueue: ArtifactProcessingQueue;
  artifactStatusPublisher: ArtifactStatusPublisher;
};

const AUTOMATIC_RETRY_DELAYS_MS = [
  30_000,
  120_000,
  600_000,
  1_800_000,
  7_200_000,
] as const;

export function nextAutomaticRetry(metadata: Record<string, unknown>): {
  count: number;
  delayMs: number;
  nextRetryAt: Date;
} | null {
  const processing = artifactMetadata(metadata["processing"]);
  const currentCount = typeof processing["autoRetryCount"] === "number"
    ? processing["autoRetryCount"]
    : 0;
  const delayMs = AUTOMATIC_RETRY_DELAYS_MS[currentCount];

  if (!delayMs) {
    return null;
  }

  return {
    count: currentCount + 1,
    delayMs,
    nextRetryAt: new Date(Date.now() + delayMs),
  };
}

function approximateBase64Bytes(value: string): number {
  return Math.ceil((value.length * 3) / 4);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function readArtifactStatus(db: Db, input: { artifactId: string; twinId: string }) {
  const [artifact] = await db
    .select({
      ingestionStatus: sourceArtifacts.ingestionStatus,
      metadata: sourceArtifacts.metadata,
    })
    .from(sourceArtifacts)
    .where(and(
      eq(sourceArtifacts.id, input.artifactId),
      eq(sourceArtifacts.twinId, input.twinId),
    ))
    .limit(1);

  if (!artifact) {
    return null;
  }

  return {
    ingestionStatus: artifact.ingestionStatus,
    reason: readProcessingReason(artifact.metadata),
    intelligenceStatus: readIntelligenceStatus(artifact.metadata),
    processing: artifactMetadata(artifactMetadata(artifact.metadata)["processing"]),
  };
}

async function verifyArtifactJobTwinBoundary(
  deps: ArtifactProcessingJobDeps,
  data: ArtifactProcessingJobData,
) {
  const artifact = await deps.repository.findArtifactById(data.artifactId);

  if (!artifact) {
    console.warn(`${deps.serviceName} artifact processing rejected missing artifact`, {
      artifactId: data.artifactId,
      payloadTwinId: data.twinId,
    });
    return false;
  }

  if (artifact.twinId === data.twinId) {
    return true;
  }

  await deps.repository.createAuditEvent({
    twinId: artifact.twinId,
    eventType: "artifact.processing_rejected_twin_mismatch",
    resourceId: data.artifactId,
    metadata: {
      payloadTwinId: data.twinId,
      artifactTwinId: artifact.twinId,
      sourceType: data.sourceType,
    },
  });
  console.error(`${deps.serviceName} artifact processing rejected twin mismatch`, {
    artifactId: data.artifactId,
    payloadTwinId: data.twinId,
    artifactTwinId: artifact.twinId,
  });
  return false;
}

async function markNonRetryableArtifactFailure(
  deps: ArtifactProcessingJobDeps,
  data: ArtifactProcessingJobData,
  error: unknown,
) {
  const artifact = await deps.repository.findArtifactById(data.artifactId);
  const metadata = artifactMetadata(artifact?.metadata);
  const reason = "artifact_processing_failed";
  const detail = errorMessage(error);
  const nextMetadata = {
    ...metadata,
    processing: {
      ...artifactMetadata(metadata["processing"]),
      status: "failed",
      reason,
      detail,
      processedAt: new Date().toISOString(),
    },
  };

  await deps.repository.markArtifactFailed(data.artifactId, nextMetadata);
  await deps.repository.createAuditEvent({
    twinId: data.twinId,
    eventType: "artifact.processing_failed",
    resourceId: data.artifactId,
    metadata: {
      reason,
      detail,
      sourceType: data.sourceType,
    },
  });
  await deps.artifactStatusPublisher.publishArtifactStatus({
    artifactId: data.artifactId,
    twinId: data.twinId,
    sourceType: data.sourceType,
    status: "failed",
    reason,
    processing: nextMetadata.processing,
    occurredAt: new Date().toISOString(),
  });

  console.error(`${deps.serviceName} non-retryable artifact processing failure`, {
    artifactId: data.artifactId,
    reason,
    detail,
  });
}

async function resolveTransientCiphertext(
  deps: ArtifactProcessingJobDeps,
  data: ArtifactProcessingJobData,
) {
  if (data.transientCiphertextBase64) {
    return null;
  }

  return deps.transientCiphertextCache.getArtifactCiphertext(data.artifactId).catch((error: unknown) => {
    console.warn(`${deps.serviceName} transient artifact ciphertext lookup failed`, {
      artifactId: data.artifactId,
      error: errorMessage(error),
    });
    return null;
  });
}

async function scheduleArtifactAutoRetry(
  deps: ArtifactProcessingJobDeps,
  data: ArtifactProcessingJobData,
  job: ArtifactProcessingJob,
  error: RetryableArtifactProcessingError,
  retryPlan: { count: number; delayMs: number; nextRetryAt: Date },
) {
  const artifact = await deps.repository.findArtifactById(data.artifactId);
  const metadata = artifactMetadata(artifact?.metadata);
  const now = new Date();
  const nextMetadata = {
    ...metadata,
    processing: {
      ...artifactMetadata(metadata["processing"]),
      status: "pending",
      reason: error.reason,
      detail: error.detail,
      autoRetryCount: retryPlan.count,
      nextRetryAt: retryPlan.nextRetryAt.toISOString(),
      processedAt: now.toISOString(),
    },
  };

  await deps.repository.markArtifactPending(data.artifactId, nextMetadata);
  await deps.repository.createAuditEvent({
    twinId: data.twinId,
    eventType: "artifact.processing_auto_retry_scheduled",
    resourceId: data.artifactId,
    metadata: {
      reason: error.reason,
      detail: error.detail,
      autoRetryCount: retryPlan.count,
      nextRetryAt: retryPlan.nextRetryAt.toISOString(),
      delayMs: retryPlan.delayMs,
    },
  });
  await deps.artifactRetryQueue.enqueueArtifactProcessing({
    artifactId: data.artifactId,
    twinId: data.twinId,
    sourceType: data.sourceType,
    jobKey: `auto-retry-${retryPlan.count}-${Date.now()}`,
    delayMs: retryPlan.delayMs,
  });
  await deps.artifactStatusPublisher.publishArtifactStatus({
    artifactId: data.artifactId,
    twinId: data.twinId,
    sourceType: data.sourceType,
    status: "pending",
    reason: error.reason,
    occurredAt: now.toISOString(),
  });

  console.warn(`${deps.serviceName} artifact auto retry scheduled`, {
    jobId: job.id,
    artifactId: data.artifactId,
    autoRetryCount: retryPlan.count,
    delayMs: retryPlan.delayMs,
    nextRetryAt: retryPlan.nextRetryAt.toISOString(),
  });
}

async function markArtifactDeadLetter(
  deps: ArtifactProcessingJobDeps,
  data: ArtifactProcessingJobData,
  error: RetryableArtifactProcessingError,
) {
  const artifact = await deps.repository.findArtifactById(data.artifactId);
  const metadata = artifactMetadata(artifact?.metadata);
  const nextMetadata = {
    ...metadata,
    processing: {
      ...artifactMetadata(metadata["processing"]),
      status: "failed",
      reason: ENCRYPTED_DECRYPTION_FAILED,
      detail: error.detail,
      deadLetter: true,
      processedAt: new Date().toISOString(),
    },
  };

  await deps.repository.markArtifactFailed(data.artifactId, nextMetadata);
  await deps.repository.createAuditEvent({
    twinId: data.twinId,
    eventType: "artifact.processing_failed",
    resourceId: data.artifactId,
    metadata: {
      reason: ENCRYPTED_DECRYPTION_FAILED,
      detail: error.detail,
      deadLetter: true,
    },
  });
  await deps.artifactStatusPublisher.publishArtifactStatus({
    artifactId: data.artifactId,
    twinId: data.twinId,
    sourceType: data.sourceType,
    status: "failed",
    reason: ENCRYPTED_DECRYPTION_FAILED,
    occurredAt: new Date().toISOString(),
  });
}

async function handleRetryableArtifactError(
  deps: ArtifactProcessingJobDeps,
  data: ArtifactProcessingJobData,
  job: ArtifactProcessingJob,
  error: RetryableArtifactProcessingError,
): Promise<"retry_scheduled" | "dead_letter" | "will_retry"> {
  const attempt = job.attemptsMade + 1;
  const attempts = typeof job.opts.attempts === "number" ? job.opts.attempts : 1;
  const exhausted = attempt >= attempts;

  console.warn(`${deps.serviceName} retryable artifact processing failure`, {
    jobId: job.id,
    artifactId: data.artifactId,
    attempt,
    attempts,
    reason: error.reason,
    detail: error.detail,
    exhausted,
  });

  if (!exhausted) {
    await deps.artifactStatusPublisher.publishArtifactStatus({
      artifactId: data.artifactId,
      twinId: data.twinId,
      sourceType: data.sourceType,
      status: "pending",
      reason: error.reason,
      occurredAt: new Date().toISOString(),
    });
    return "will_retry";
  }

  const metadata = artifactMetadata(
    (await deps.repository.findArtifactById(data.artifactId))?.metadata,
  );
  const retryPlan = nextAutomaticRetry(metadata);

  if (retryPlan) {
    await scheduleArtifactAutoRetry(deps, data, job, error, retryPlan);
    return "retry_scheduled";
  }

  await markArtifactDeadLetter(deps, data, error);
  return "dead_letter";
}

async function publishArtifactCompletionStatus(
  deps: ArtifactProcessingJobDeps,
  data: ArtifactProcessingJobData,
  result: Awaited<ReturnType<typeof processArtifact>>,
) {
  if (result === "skipped") {
    return;
  }

  const status = await readArtifactStatus(deps.db, {
    artifactId: data.artifactId,
    twinId: data.twinId,
  });

  await deps.artifactStatusPublisher.publishArtifactStatus({
    artifactId: data.artifactId,
    twinId: data.twinId,
    sourceType: data.sourceType,
    status: status?.ingestionStatus ?? result,
    intelligenceStatus: status?.intelligenceStatus,
    reason: status?.reason,
    processing: status?.processing,
    occurredAt: new Date().toISOString(),
  });
}

async function runArtifactProcessingJob(
  deps: ArtifactProcessingJobDeps,
  data: ArtifactProcessingJobData,
  job: ArtifactProcessingJob,
): Promise<void> {
  try {
    const boundaryOk = await verifyArtifactJobTwinBoundary(deps, data);
    if (!boundaryOk) {
      return;
    }

    const transientCiphertext = await resolveTransientCiphertext(deps, data);

    if (transientCiphertext) {
      console.log(`${deps.serviceName} transient artifact ciphertext cache hit`, {
        artifactId: data.artifactId,
        ciphertextBytesApprox: approximateBase64Bytes(transientCiphertext.ciphertextBase64),
      });
    }

    const result = await executeArtifactProcessingAttempt(deps, data, transientCiphertext);

    await publishArtifactCompletionStatus(deps, data, result);

    console.log(`${deps.serviceName} job processed`, {
      jobId: job.id,
      artifactId: data.artifactId,
      result,
    });
  } catch (error) {
    if (!isRetryableArtifactJobError(error)) {
      await markNonRetryableArtifactFailure(deps, data, error);
      return;
    }

    const outcome = await handleRetryableArtifactError(deps, data, job, error);

    if (shouldDeadLetterArtifactJob({ outcome })) {
      throw error;
    }
  }
}

export function createArtifactProcessingJobHandler(deps: ArtifactProcessingJobDeps) {
  return (data: ArtifactProcessingJobData, job: ArtifactProcessingJob) =>
    runArtifactProcessingJob(deps, data, job);
}
