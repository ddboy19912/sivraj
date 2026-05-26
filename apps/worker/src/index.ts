import "./env.js";
import { resolveDatabaseUrl } from "@sivraj/config";
import { sourceArtifacts, type Db } from "@sivraj/db";
import {
  createConfiguredSpeechToTextTranscriber,
  createConfiguredStructuredGenerator,
} from "@sivraj/llm";
import {
  createArtifactProcessingQueue,
  createArtifactProcessingWorker,
  createArtifactStatusPublisher,
  createCandidateMemoryArchiveQueue,
  createCandidateMemoryArchiveWorker,
  createIntelligenceProcessingQueue,
  createIntelligenceProcessingWorker,
  createTransientCiphertextCache,
  createWeeklyReflectionWorker,
} from "@sivraj/queue";
import { eq } from "drizzle-orm";
import { createWorkerDb } from "./db.js";
import {
  processArtifact,
  processCandidateMemoryArchive,
  createCanonicalMemoryMergeJudge,
  createEntityExtractor,
  createEngineeringMemoryExtractor,
  createMemoryExtractor,
  processArtifactIntelligence,
  processQueuedArtifacts,
  generateWeeklyReflection,
  ENCRYPTED_DECRYPTION_FAILED,
  RetryableArtifactProcessingError,
} from "./ingestion-processor.js";
import { runHealthJob } from "./jobs/health";
import { createConfiguredPrivateMemoryReader } from "./private-memory-reader.js";
import { createConfiguredPrivateFragmentStorage } from "./private-fragment-storage.js";
import { createDrizzleArtifactRepository } from "./repository.js";

export const serviceName = "sivraj-worker";

async function main() {
  console.log(`${serviceName} booting`);

  await runHealthJob();

  const { db, close } = createWorkerDb(resolveDatabaseUrl(process.env));
  const repository = createDrizzleArtifactRepository(db);
  const privateMemoryReader = createConfiguredPrivateMemoryReader(process.env);
  const privateFragmentStorage = createConfiguredPrivateFragmentStorage(process.env);
  const speechToTextTranscriber = createConfiguredSpeechToTextTranscriber(process.env);
  const structuredGenerator = createConfiguredStructuredGenerator(process.env);
  const entityExtractor = structuredGenerator
    ? createEntityExtractor(structuredGenerator)
    : undefined;
  const memoryExtractor = structuredGenerator
    ? createMemoryExtractor(structuredGenerator)
    : undefined;
  const engineeringMemoryExtractor = structuredGenerator
    ? createEngineeringMemoryExtractor(structuredGenerator)
    : undefined;
  const canonicalMemoryMergeJudge = structuredGenerator
    ? createCanonicalMemoryMergeJudge(structuredGenerator)
    : undefined;
  const redisUrl = readRequired(process.env["REDIS_URL"], "REDIS_URL");
  const artifactStatusPublisher = createArtifactStatusPublisher(redisUrl);
  const artifactRetryQueue = createArtifactProcessingQueue(redisUrl);
  const transientCiphertextCache = createTransientCiphertextCache(redisUrl);
  const intelligenceQueue = createIntelligenceProcessingQueue(redisUrl);
  const candidateMemoryArchiveQueue = createCandidateMemoryArchiveQueue(redisUrl);
  const concurrency = readPositiveInt(process.env["WORKER_CONCURRENCY"], 2);
  const intelligenceChunkChars = readPositiveInt(process.env["INTELLIGENCE_CHUNK_CHARS"], 18_000);
  const intelligenceChunkConcurrency = readPositiveInt(process.env["INTELLIGENCE_CHUNK_CONCURRENCY"], 2);
  const artifactReconcileIntervalMs = readPositiveInt(process.env["ARTIFACT_RECONCILE_INTERVAL_MS"], 60_000);
  const artifactReconcileLimit = readPositiveInt(process.env["ARTIFACT_RECONCILE_LIMIT"], 25);

  if (process.env["WORKER_DRAIN_EXISTING_ON_BOOT"] !== "false") {
    const result = await processQueuedArtifacts(repository, {
      limit: readPositiveInt(process.env["WORKER_BOOT_DRAIN_LIMIT"], 100),
      privateMemoryReader,
      privateFragmentStorage,
      speechToTextTranscriber: speechToTextTranscriber ?? undefined,
      intelligenceQueue,
    });

    console.log(`${serviceName} boot drain processed`, result);
  }

  const worker = createArtifactProcessingWorker(
    redisUrl,
    async (data, job) => {
      let result: Awaited<ReturnType<typeof processArtifact>>;

      try {
        const transientCiphertext = data.transientCiphertextBase64
          ? null
          : await transientCiphertextCache.getArtifactCiphertext(data.artifactId).catch((error: unknown) => {
              console.warn(`${serviceName} transient artifact ciphertext lookup failed`, {
                artifactId: data.artifactId,
                error: errorMessage(error),
              });
              return null;
            });

        if (transientCiphertext) {
          console.log(`${serviceName} transient artifact ciphertext cache hit`, {
            artifactId: data.artifactId,
            ciphertextBytesApprox: approximateBase64Bytes(transientCiphertext.ciphertextBase64),
          });
        }

        result = await processArtifact(repository, data.artifactId, {
          privateMemoryReader,
          privateFragmentStorage,
          speechToTextTranscriber: speechToTextTranscriber ?? undefined,
          intelligenceQueue,
          transientCiphertextBase64: data.transientCiphertextBase64 ?? transientCiphertext?.ciphertextBase64,
          transientCiphertextSha256: data.transientCiphertextSha256 ?? transientCiphertext?.ciphertextSha256,
        });
      } catch (error) {
        if (error instanceof RetryableArtifactProcessingError) {
          const attempt = job.attemptsMade + 1;
          const attempts = typeof job.opts.attempts === "number" ? job.opts.attempts : 1;
          const exhausted = attempt >= attempts;

          console.warn(`${serviceName} retryable artifact processing failure`, {
            jobId: job.id,
            artifactId: data.artifactId,
            attempt,
            attempts,
            reason: error.reason,
            detail: error.detail,
            exhausted,
          });

          if (exhausted) {
            const artifact = await repository.findArtifactById(data.artifactId);
            const metadata = artifactMetadata(artifact?.metadata);
            const retryPlan = nextAutomaticRetry(metadata);

            if (retryPlan) {
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

              await repository.markArtifactPending(data.artifactId, nextMetadata);
              await repository.createAuditEvent({
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
              await artifactRetryQueue.enqueueArtifactProcessing({
                artifactId: data.artifactId,
                twinId: data.twinId,
                sourceType: data.sourceType,
                jobKey: `auto-retry-${retryPlan.count}-${Date.now()}`,
                delayMs: retryPlan.delayMs,
              });
              await artifactStatusPublisher.publishArtifactStatus({
                artifactId: data.artifactId,
                twinId: data.twinId,
                sourceType: data.sourceType,
                status: "pending",
                reason: error.reason,
                occurredAt: now.toISOString(),
              });

              console.warn(`${serviceName} artifact auto retry scheduled`, {
                jobId: job.id,
                artifactId: data.artifactId,
                autoRetryCount: retryPlan.count,
                delayMs: retryPlan.delayMs,
                nextRetryAt: retryPlan.nextRetryAt.toISOString(),
              });

              return;
            }

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

            await repository.markArtifactFailed(data.artifactId, nextMetadata);
            await repository.createAuditEvent({
              twinId: data.twinId,
              eventType: "artifact.processing_failed",
              resourceId: data.artifactId,
              metadata: {
                reason: ENCRYPTED_DECRYPTION_FAILED,
                detail: error.detail,
                deadLetter: true,
              },
            });
            await artifactStatusPublisher.publishArtifactStatus({
              artifactId: data.artifactId,
              twinId: data.twinId,
              sourceType: data.sourceType,
              status: "failed",
              reason: ENCRYPTED_DECRYPTION_FAILED,
              occurredAt: new Date().toISOString(),
            });

            throw error;
          }

          await artifactStatusPublisher.publishArtifactStatus({
            artifactId: data.artifactId,
            twinId: data.twinId,
            sourceType: data.sourceType,
            status: "pending",
            reason: error.reason,
            occurredAt: new Date().toISOString(),
          });
        }

        throw error;
      }

      if (result !== "skipped") {
        const status = await readArtifactStatus(db, data.artifactId);

        await artifactStatusPublisher.publishArtifactStatus({
          artifactId: data.artifactId,
          twinId: data.twinId,
          sourceType: data.sourceType,
          status: status?.ingestionStatus ?? result,
          intelligenceStatus: status?.intelligenceStatus,
          reason: status?.reason,
          occurredAt: new Date().toISOString(),
        });
      }

      console.log(`${serviceName} job processed`, {
        jobId: job.id,
        artifactId: data.artifactId,
        result,
      });
    },
    { concurrency },
  );

  worker.onCompleted((jobId) => {
    console.log(`${serviceName} job completed`, { jobId });
  });
  worker.onFailed((jobId, error, attemptsMade) => {
    console.error(`${serviceName} job failed`, {
      jobId,
      attemptsMade,
      errorName: error.name,
      errorMessage: error.message,
    });
  });

  const intelligenceWorker = createIntelligenceProcessingWorker(
    redisUrl,
    async (data, job) => {
      await artifactStatusPublisher.publishArtifactStatus({
        artifactId: data.artifactId,
        twinId: data.twinId,
        sourceType: data.sourceType,
        status: "completed",
        intelligenceStatus: "processing",
        occurredAt: new Date().toISOString(),
      });

      const startedAt = Date.now();
      const result = await processArtifactIntelligence(repository, {
        artifactId: data.artifactId,
        twinId: data.twinId,
        sourceType: data.sourceType,
        memoryFragmentId: data.memoryFragmentId,
        transientFragmentCiphertextBase64: data.transientFragmentCiphertextBase64,
        transientFragmentCiphertextSha256: data.transientFragmentCiphertextSha256,
        privateMemoryReader,
        privateFragmentStorage,
        entityExtractor,
        memoryExtractor,
        engineeringMemoryExtractor,
        canonicalMemoryMergeJudge,
        candidateMemoryArchiveQueue,
        intelligenceChunkChars,
        intelligenceChunkConcurrency,
      });

      await artifactStatusPublisher.publishArtifactStatus({
        artifactId: data.artifactId,
        twinId: data.twinId,
        sourceType: data.sourceType,
        status: "completed",
        intelligenceStatus: result["status"] === "failed" ? "failed" : "completed",
        occurredAt: new Date().toISOString(),
      });

      console.log(`${serviceName} intelligence job processed`, {
        jobId: job.id,
        artifactId: data.artifactId,
        result: result.status,
        durationMs: Date.now() - startedAt,
      });
    },
    { concurrency },
  );

  intelligenceWorker.onCompleted((jobId) => {
    console.log(`${serviceName} intelligence job completed`, { jobId });
  });
  intelligenceWorker.onFailed((jobId, error, attemptsMade) => {
    console.error(`${serviceName} intelligence job failed`, {
      jobId,
      attemptsMade,
      errorName: error.name,
      errorMessage: error.message,
    });
  });

  const candidateMemoryArchiveWorker = createCandidateMemoryArchiveWorker(
    redisUrl,
    async (data, job) => {
      const startedAt = Date.now();
      const result = await processCandidateMemoryArchive(repository, {
        artifactId: data.artifactId,
        twinId: data.twinId,
        memoryFragmentId: data.memoryFragmentId,
        sourceType: data.sourceType,
        candidateMemoryIds: data.candidateMemoryIds,
        encryptedBytesBase64: data.encryptedBytesBase64,
        contentSha256: data.contentSha256,
        metadata: data.metadata,
        privateFragmentStorage,
      });

      console.log(`${serviceName} candidate memory archive job processed`, {
        jobId: job.id,
        artifactId: data.artifactId,
        result: result.status,
        candidateMemoryCount: result.candidateMemoryCount,
        archiveMs: result.archiveMs,
        durationMs: Date.now() - startedAt,
      });
    },
    { concurrency: readPositiveInt(process.env["CANDIDATE_MEMORY_ARCHIVE_CONCURRENCY"], 1) },
  );

  candidateMemoryArchiveWorker.onCompleted((jobId) => {
    console.log(`${serviceName} candidate memory archive job completed`, { jobId });
  });

  const weeklyReflectionWorker = createWeeklyReflectionWorker(
    redisUrl,
    async (data, job) => {
      const startedAt = Date.now();
      const result = await generateWeeklyReflection(repository, {
        reflectionRunId: data.reflectionRunId,
        twinId: data.twinId,
        periodStart: new Date(data.periodStart),
        periodEnd: new Date(data.periodEnd),
        generator: structuredGenerator ?? undefined,
        privateFragmentStorage,
      });

      console.log(`${serviceName} weekly reflection job processed`, {
        jobId: job.id,
        reflectionRunId: data.reflectionRunId,
        result: result.status,
        durationMs: Date.now() - startedAt,
      });
    },
    { concurrency: readPositiveInt(process.env["WEEKLY_REFLECTION_CONCURRENCY"], 1) },
  );

  weeklyReflectionWorker.onCompleted((jobId) => {
    console.log(`${serviceName} weekly reflection job completed`, { jobId });
  });
  weeklyReflectionWorker.onFailed((jobId, error, attemptsMade) => {
    console.error(`${serviceName} weekly reflection job failed`, {
      jobId,
      attemptsMade,
      errorName: error.name,
      errorMessage: error.message,
    });
  });
  candidateMemoryArchiveWorker.onFailed((jobId, error, attemptsMade) => {
    console.error(`${serviceName} candidate memory archive job failed`, {
      jobId,
      attemptsMade,
      errorName: error.name,
      errorMessage: error.message,
    });
  });

  const reconciler = setInterval(() => {
    void processQueuedArtifacts(repository, {
      limit: artifactReconcileLimit,
      privateMemoryReader,
      privateFragmentStorage,
      speechToTextTranscriber: speechToTextTranscriber ?? undefined,
      intelligenceQueue,
    })
      .then((result) => {
        if (result.scanned > 0) {
          console.log(`${serviceName} artifact reconciler processed`, result);
        }
      })
      .catch((error: unknown) => {
        console.error(`${serviceName} artifact reconciler failed`, error);
      });
  }, artifactReconcileIntervalMs);

  console.log(`${serviceName} ready`, {
    queue: "sivraj-artifact-processing",
    intelligenceQueue: "sivraj-intelligence-processing",
    candidateMemoryArchiveQueue: "sivraj-candidate-memory-archive",
    weeklyReflectionQueue: "sivraj-weekly-reflection",
    concurrency,
    entityExtraction: entityExtractor ? "enabled" : "disabled",
    memoryExtraction: memoryExtractor ? "enabled" : "disabled",
    semanticMemoryConsolidation: canonicalMemoryMergeJudge ? "enabled" : "disabled",
    intelligenceChunkChars,
    intelligenceChunkConcurrency,
    artifactReconcileIntervalMs,
    artifactReconcileLimit,
    automaticRetryDelaysMs: AUTOMATIC_RETRY_DELAYS_MS,
    llmModel: process.env["LLM_MODEL"] || null,
    llmBaseUrl: process.env["OPENAI_BASE_URL"] || "https://api.openai.com",
  });

  await waitForShutdown();
  clearInterval(reconciler);
  await candidateMemoryArchiveWorker.close();
  await weeklyReflectionWorker.close();
  await intelligenceWorker.close();
  await worker.close();
  await candidateMemoryArchiveQueue.close();
  await intelligenceQueue.close();
  await transientCiphertextCache.close();
  await artifactRetryQueue.close();
  await artifactStatusPublisher.close();
  await close();
}

main().catch((error: unknown) => {
  console.error(`${serviceName} failed`, error);
  process.exitCode = 1;
});

function readRequired(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function readPositiveInt(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function artifactMetadata(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

const AUTOMATIC_RETRY_DELAYS_MS = [
  30_000,
  120_000,
  600_000,
  1_800_000,
  7_200_000,
] as const;

function nextAutomaticRetry(metadata: Record<string, unknown>): {
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

async function readArtifactStatus(db: Db, artifactId: string) {
  const [artifact] = await db
    .select({
      ingestionStatus: sourceArtifacts.ingestionStatus,
      metadata: sourceArtifacts.metadata,
    })
    .from(sourceArtifacts)
    .where(eq(sourceArtifacts.id, artifactId))
    .limit(1);

  if (!artifact) {
    return null;
  }

  return {
    ingestionStatus: artifact.ingestionStatus,
    reason: readProcessingReason(artifact.metadata),
    intelligenceStatus: readIntelligenceStatus(artifact.metadata),
  };
}

function readProcessingReason(metadata: unknown): string | undefined {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return undefined;
  }

  const processing = (metadata as Record<string, unknown>)["processing"];

  if (!processing || typeof processing !== "object" || Array.isArray(processing)) {
    return undefined;
  }

  const reason = (processing as Record<string, unknown>)["reason"];

  return typeof reason === "string" ? reason : undefined;
}

function readIntelligenceStatus(metadata: unknown): "queued" | "processing" | "completed" | "failed" | "skipped" | undefined {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return undefined;
  }

  const processing = (metadata as Record<string, unknown>)["processing"];

  if (!processing || typeof processing !== "object" || Array.isArray(processing)) {
    return undefined;
  }

  const intelligence = (processing as Record<string, unknown>)["intelligence"];

  if (!intelligence || typeof intelligence !== "object" || Array.isArray(intelligence)) {
    return undefined;
  }

  const status = (intelligence as Record<string, unknown>)["status"];

  return status === "queued" ||
    status === "processing" ||
    status === "completed" ||
    status === "failed" ||
    status === "skipped"
    ? status
    : undefined;
}

function waitForShutdown(): Promise<void> {
  return new Promise((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });
}
