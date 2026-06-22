import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  createArtifactProcessingQueue,
  createArtifactProcessingWorker,
  createArtifactStatusPublisher,
  createCandidateMemoryArchiveQueue,
  createCandidateMemoryArchiveWorker,
  createConnectorSyncQueue,
  createConnectorSyncWorker,
  createContextWarmupQueue,
  createContextWarmupWorker,
  createIntelligenceProcessingQueue,
  createIntelligenceProcessingWorker,
  createTransientCiphertextCache,
  createWeeklyReflectionWorker,
} from "@sivraj/queue";
import { enqueueDueConnectorSyncs, processConnectorSyncRun } from "./connectors.js";
import { processContextWarmup } from "./context-warmup.js";
import {
  enqueueDueCandidateMemoryArchives,
  processCandidateMemoryArchive,
  processArtifactIntelligence,
  processQueuedArtifacts,
  generateWeeklyReflection,
} from "./ingestion-processor.js";
import { createArtifactProcessingJobHandler } from "./artifact-processing-job.js";
import type { createWorkerDb } from "./db.js";
import type { createDrizzleArtifactRepository } from "./repository.js";
import type { createConfiguredPrivateMemoryReader } from "@sivraj/private-memory-reader";
import type { createPrivateMemoryCiphertextCache } from "@sivraj/queue";
import type { createConfiguredPrivateFragmentStorage } from "./private-fragment-storage.js";
import type { createConfiguredPrivateSourceStorage } from "./private-source-storage.js";
import type {
  createConfiguredSpeechToTextTranscriber,
  createConfiguredStructuredGenerator,
  createConfiguredTextEmbedder,
} from "@sivraj/llm";
import { readPositiveInt } from "./lib/env-utils.js";

const execFileAsync = promisify(execFile);
const memoryRenewalScriptPath = fileURLToPath(new URL("../scripts/renew-memory.mjs", import.meta.url));

type WorkerDb = ReturnType<typeof createWorkerDb>;
type ArtifactRepository = ReturnType<typeof createDrizzleArtifactRepository>;
type PrivateMemoryReader = ReturnType<typeof createConfiguredPrivateMemoryReader>;
type PrivateMemoryCiphertextCache = ReturnType<typeof createPrivateMemoryCiphertextCache>;
type PrivateFragmentStorage = ReturnType<typeof createConfiguredPrivateFragmentStorage>;
type PrivateSourceStorage = ReturnType<typeof createConfiguredPrivateSourceStorage>;
type SpeechToTextTranscriber = ReturnType<typeof createConfiguredSpeechToTextTranscriber>;
type TextEmbedder = ReturnType<typeof createConfiguredTextEmbedder>;
type StructuredGenerator = ReturnType<typeof createConfiguredStructuredGenerator>;

export type WorkerRuntime = {
  worker: ReturnType<typeof createArtifactProcessingWorker>;
  intelligenceWorker: ReturnType<typeof createIntelligenceProcessingWorker>;
  candidateMemoryArchiveWorker: ReturnType<typeof createCandidateMemoryArchiveWorker>;
  weeklyReflectionWorker: ReturnType<typeof createWeeklyReflectionWorker>;
  connectorSyncWorker: ReturnType<typeof createConnectorSyncWorker>;
  contextWarmupWorker: ReturnType<typeof createContextWarmupWorker>;
  reconciler: ReturnType<typeof setInterval>;
  connectorReconciler: ReturnType<typeof setInterval>;
  candidateMemoryArchiveReconciler: ReturnType<typeof setInterval>;
  memoryRenewalReconciler: ReturnType<typeof setInterval>;
  close: () => Promise<void>;
};

export type WorkerBootstrapInput = {
  serviceName: string;
  db: WorkerDb["db"];
  closeDb: WorkerDb["close"];
  repository: ArtifactRepository;
  privateMemoryCiphertextCache: PrivateMemoryCiphertextCache;
  privateMemoryReader: PrivateMemoryReader;
  privateFragmentStorage: PrivateFragmentStorage;
  privateSourceStorage: PrivateSourceStorage;
  speechToTextTranscriber: SpeechToTextTranscriber | null;
  textEmbedder: TextEmbedder | null;
  structuredGenerator: StructuredGenerator | null;
  entityExtractor: ReturnType<typeof import("./ingestion-processor.js").createEntityExtractor> | undefined;
  memoryExtractor: ReturnType<typeof import("./ingestion-processor.js").createMemoryExtractor> | undefined;
  engineeringMemoryExtractor: ReturnType<typeof import("./ingestion-processor.js").createEngineeringMemoryExtractor> | undefined;
  canonicalMemoryMergeJudge: ReturnType<typeof import("./ingestion-processor.js").createCanonicalMemoryMergeJudge> | undefined;
  redisUrl: string;
  concurrency: number;
  intelligenceChunkChars: number;
  intelligenceChunkConcurrency: number;
  artifactReconcileIntervalMs: number;
  artifactReconcileLimit: number;
  connectorReconcileIntervalMs: number;
  connectorReconcileLimit: number;
  candidateMemoryArchiveReconcileIntervalMs: number;
  candidateMemoryArchiveReconcileLimit: number;
  memoryRenewalIntervalMs: number;
  memoryRenewalLimit: number;
};

function runReconcilerTask<T>(params: {
  serviceName: string;
  failureLabel: string;
  task: () => Promise<T>;
  onSuccess: (result: T) => void;
}): void {
  void params.task()
    .then(params.onSuccess)
    .catch((error: unknown) => {
      console.error(`${params.serviceName} ${params.failureLabel} failed`, error);
    });
}

export function createWorkerRuntime(input: WorkerBootstrapInput): WorkerRuntime {
  const artifactStatusPublisher = createArtifactStatusPublisher(input.redisUrl);
  const artifactRetryQueue = createArtifactProcessingQueue(input.redisUrl);
  const transientCiphertextCache = createTransientCiphertextCache(input.redisUrl);
  const intelligenceQueue = createIntelligenceProcessingQueue(input.redisUrl);
  const candidateMemoryArchiveQueue = createCandidateMemoryArchiveQueue(input.redisUrl);
  const connectorSyncQueue = createConnectorSyncQueue(input.redisUrl);
  const contextWarmupQueue = createContextWarmupQueue(input.redisUrl);

  const connectorSyncWorker = createConnectorSyncWorker(
    input.redisUrl,
    async (data, job) => {
      const startedAt = Date.now();
      const result = await processConnectorSyncRun({
        db: input.db,
        data,
        privateSourceStorage: input.privateSourceStorage,
        artifactProcessingQueue: artifactRetryQueue,
      });

      console.log(`${input.serviceName} connector sync job processed`, {
        jobId: job.id,
        syncRunId: data.syncRunId,
        provider: data.provider,
        status: result.status,
        addedCount: result.addedCount,
        updatedCount: result.updatedCount,
        skippedCount: result.skippedCount,
        failedCount: result.failedCount,
        durationMs: Date.now() - startedAt,
      });
    },
    { concurrency: readPositiveInt(process.env["CONNECTOR_SYNC_CONCURRENCY"], 1) },
  );

  const worker = createArtifactProcessingWorker(
    input.redisUrl,
    createArtifactProcessingJobHandler({
      serviceName: input.serviceName,
      repository: input.repository,
      db: input.db,
      privateMemoryReader: input.privateMemoryReader,
      privateFragmentStorage: input.privateFragmentStorage,
      speechToTextTranscriber: input.speechToTextTranscriber,
      textEmbedder: input.textEmbedder,
      structuredGenerator: input.structuredGenerator,
      intelligenceQueue,
      transientCiphertextCache,
      artifactRetryQueue,
      artifactStatusPublisher,
    }),
    { concurrency: input.concurrency },
  );

  const intelligenceWorker = createIntelligenceProcessingWorker(
    input.redisUrl,
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
      const result = await processArtifactIntelligence(input.repository, {
        artifactId: data.artifactId,
        twinId: data.twinId,
        sourceType: data.sourceType,
        memoryFragmentId: data.memoryFragmentId,
        transientFragmentCiphertextBase64: data.transientFragmentCiphertextBase64,
        transientFragmentCiphertextSha256: data.transientFragmentCiphertextSha256,
        privateMemoryReader: input.privateMemoryReader,
        privateFragmentStorage: input.privateFragmentStorage,
        entityExtractor: input.entityExtractor,
        memoryExtractor: input.memoryExtractor,
        engineeringMemoryExtractor: input.engineeringMemoryExtractor,
        canonicalMemoryMergeJudge: input.canonicalMemoryMergeJudge,
        candidateMemoryArchiveQueue,
        intelligenceChunkChars: input.intelligenceChunkChars,
        intelligenceChunkConcurrency: input.intelligenceChunkConcurrency,
      });

      await artifactStatusPublisher.publishArtifactStatus({
        artifactId: data.artifactId,
        twinId: data.twinId,
        sourceType: data.sourceType,
        status: "completed",
        intelligenceStatus: result["status"] === "failed" ? "failed" : "completed",
        occurredAt: new Date().toISOString(),
      });

      console.log(`${input.serviceName} intelligence job processed`, {
        jobId: job.id,
        artifactId: data.artifactId,
        result: result.status,
        durationMs: Date.now() - startedAt,
      });
    },
    { concurrency: input.concurrency },
  );

  const candidateMemoryArchiveWorker = createCandidateMemoryArchiveWorker(
    input.redisUrl,
    async (data, job) => {
      const startedAt = Date.now();
      const result = await processCandidateMemoryArchive(input.repository, {
        archiveId: data.archiveId,
        artifactId: data.artifactId,
        twinId: data.twinId,
        memoryFragmentId: data.memoryFragmentId,
        sourceType: data.sourceType,
        candidateMemoryIds: data.candidateMemoryIds,
        encryptedBytesBase64: data.encryptedBytesBase64,
        contentSha256: data.contentSha256,
        metadata: data.metadata,
        privateFragmentStorage: input.privateFragmentStorage,
      });

      if (result["status"] === "failed") {
        await artifactStatusPublisher.publishArtifactStatus({
          artifactId: data.artifactId,
          twinId: data.twinId,
          sourceType: data.sourceType,
          status: "completed",
          intelligenceStatus: "completed",
          reason: typeof result["reason"] === "string" ? result["reason"] : undefined,
          processing: {
            candidateMemoryArchive: {
              status: "failed",
              reason: typeof result["reason"] === "string" ? result["reason"] : undefined,
              retryable: result["retryable"] === true,
              candidateMemoryCount: result["candidateMemoryCount"],
              archiveMs: result["archiveMs"],
            },
          },
          occurredAt: new Date().toISOString(),
        });
      }

      console.log(`${input.serviceName} candidate memory archive job processed`, {
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

  const weeklyReflectionWorker = createWeeklyReflectionWorker(
    input.redisUrl,
    async (data, job) => {
      const startedAt = Date.now();
      const result = await generateWeeklyReflection(input.repository, {
        reflectionRunId: data.reflectionRunId,
        twinId: data.twinId,
        periodStart: new Date(data.periodStart),
        periodEnd: new Date(data.periodEnd),
        generator: input.structuredGenerator ?? undefined,
        privateFragmentStorage: input.privateFragmentStorage,
      });

      console.log(`${input.serviceName} weekly reflection job processed`, {
        jobId: job.id,
        reflectionRunId: data.reflectionRunId,
        result: result.status,
        durationMs: Date.now() - startedAt,
      });
    },
    { concurrency: readPositiveInt(process.env["WEEKLY_REFLECTION_CONCURRENCY"], 1) },
  );

  const contextWarmupWorker = createContextWarmupWorker(
    input.redisUrl,
    async (data, job) => {
      const startedAt = Date.now();
      const result = await processContextWarmup({
        db: input.db,
        data,
      });

      console.log(`${input.serviceName} context warmup job processed`, {
        jobId: job.id,
        twinId: data.twinId,
        surface: data.surface,
        reason: data.reason,
        itemCount: result.itemCount,
        sourceRefCount: result.sourceRefCount,
        durationMs: Date.now() - startedAt,
      });
    },
    { concurrency: readPositiveInt(process.env["CONTEXT_WARMUP_CONCURRENCY"], 1) },
  );

  attachWorkerLogging(input.serviceName, {
    worker,
    intelligenceWorker,
    candidateMemoryArchiveWorker,
    weeklyReflectionWorker,
    connectorSyncWorker,
    contextWarmupWorker,
  });

  const reconciler = setInterval(() => {
    runReconcilerTask({
      serviceName: input.serviceName,
      failureLabel: "artifact reconciler",
      task: () => processQueuedArtifacts(input.repository, {
        limit: input.artifactReconcileLimit,
        privateMemoryReader: input.privateMemoryReader,
        privateFragmentStorage: input.privateFragmentStorage,
        speechToTextTranscriber: input.speechToTextTranscriber ?? undefined,
        textEmbedder: input.textEmbedder ?? undefined,
        structuredGenerator: input.structuredGenerator ?? undefined,
        intelligenceQueue,
      }),
      onSuccess: (result) => {
        if (result.scanned > 0) {
          console.log(`${input.serviceName} artifact reconciler processed`, result);
        }
      },
    });
  }, input.artifactReconcileIntervalMs);

  const connectorReconciler = setInterval(() => {
    runReconcilerTask({
      serviceName: input.serviceName,
      failureLabel: "connector reconciler",
      task: () => enqueueDueConnectorSyncs({
        db: input.db,
        connectorSyncQueue,
        limit: input.connectorReconcileLimit,
      }),
      onSuccess: (result) => {
        if (result.queued > 0) {
          console.log(`${input.serviceName} connector reconciler queued`, result);
        }
      },
    });
  }, input.connectorReconcileIntervalMs);

  const candidateMemoryArchiveReconciler = setInterval(() => {
    runReconcilerTask({
      serviceName: input.serviceName,
      failureLabel: "candidate memory archive reconciler",
      task: () => enqueueDueCandidateMemoryArchives(input.repository, {
        limit: input.candidateMemoryArchiveReconcileLimit,
        candidateMemoryArchiveQueue,
      }),
      onSuccess: (result) => {
        if (result.scanned > 0 || result.failed > 0) {
          console.log(`${input.serviceName} candidate memory archive reconciler processed`, result);
        }
      },
    });
  }, input.candidateMemoryArchiveReconcileIntervalMs);

  const memoryRenewalReconciler = setInterval(() => {
    runReconcilerTask({
      serviceName: input.serviceName,
      failureLabel: "memory renewal reconciler",
      task: () => runMemoryRenewalReconciler({
        limit: input.memoryRenewalLimit,
      }),
      onSuccess: (result) => {
        if (result.trim().length > 0) {
          console.log(`${input.serviceName} memory renewal reconciler completed`, {
            output: result.trim().slice(0, 2000),
          });
        }
      },
    });
  }, input.memoryRenewalIntervalMs);

  return {
    worker,
    intelligenceWorker,
    candidateMemoryArchiveWorker,
    weeklyReflectionWorker,
    connectorSyncWorker,
    contextWarmupWorker,
    reconciler,
    connectorReconciler,
    candidateMemoryArchiveReconciler,
    memoryRenewalReconciler,
    close: async () => {
      clearInterval(reconciler);
      clearInterval(connectorReconciler);
      clearInterval(candidateMemoryArchiveReconciler);
      clearInterval(memoryRenewalReconciler);
      await candidateMemoryArchiveWorker.close();
      await contextWarmupWorker.close();
      await connectorSyncWorker.close();
      await weeklyReflectionWorker.close();
      await intelligenceWorker.close();
      await worker.close();
      await candidateMemoryArchiveQueue.close();
      await contextWarmupQueue.close();
      await connectorSyncQueue.close();
      await intelligenceQueue.close();
      await transientCiphertextCache.close();
      await artifactRetryQueue.close();
      await artifactStatusPublisher.close();
      await input.privateMemoryCiphertextCache.close();
      await input.closeDb();
    },
  };
}

async function runMemoryRenewalReconciler(input: {
  limit: number;
}) {
  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    [
      memoryRenewalScriptPath,
      "--yes",
      "--limit",
      String(input.limit),
    ],
    {
      env: process.env,
      maxBuffer: 1024 * 1024 * 4,
    },
  );

  return [stdout, stderr].filter(Boolean).join("\n");
}

function attachWorkerLogging(
  serviceName: string,
  workers: {
    worker: ReturnType<typeof createArtifactProcessingWorker>;
    intelligenceWorker: ReturnType<typeof createIntelligenceProcessingWorker>;
    candidateMemoryArchiveWorker: ReturnType<typeof createCandidateMemoryArchiveWorker>;
    weeklyReflectionWorker: ReturnType<typeof createWeeklyReflectionWorker>;
    connectorSyncWorker: ReturnType<typeof createConnectorSyncWorker>;
    contextWarmupWorker: ReturnType<typeof createContextWarmupWorker>;
  },
) {
  workers.worker.onCompleted((jobId) => {
    console.log(`${serviceName} job completed`, { jobId });
  });
  workers.worker.onFailed((jobId, error, attemptsMade) => {
    console.error(`${serviceName} job failed`, {
      jobId,
      attemptsMade,
      errorName: error.name,
      errorMessage: error.message,
    });
  });
  workers.intelligenceWorker.onCompleted((jobId) => {
    console.log(`${serviceName} intelligence job completed`, { jobId });
  });
  workers.intelligenceWorker.onFailed((jobId, error, attemptsMade) => {
    console.error(`${serviceName} intelligence job failed`, {
      jobId,
      attemptsMade,
      errorName: error.name,
      errorMessage: error.message,
    });
  });
  workers.candidateMemoryArchiveWorker.onCompleted((jobId) => {
    console.log(`${serviceName} candidate memory archive job completed`, { jobId });
  });
  workers.candidateMemoryArchiveWorker.onFailed((jobId, error, attemptsMade) => {
    console.error(`${serviceName} candidate memory archive job failed`, {
      jobId,
      attemptsMade,
      errorName: error.name,
      errorMessage: error.message,
    });
  });
  workers.weeklyReflectionWorker.onCompleted((jobId) => {
    console.log(`${serviceName} weekly reflection job completed`, { jobId });
  });
  workers.weeklyReflectionWorker.onFailed((jobId, error, attemptsMade) => {
    console.error(`${serviceName} weekly reflection job failed`, {
      jobId,
      attemptsMade,
      errorName: error.name,
      errorMessage: error.message,
    });
  });
  workers.connectorSyncWorker.onCompleted((jobId) => {
    console.log(`${serviceName} connector sync job completed`, { jobId });
  });
  workers.connectorSyncWorker.onFailed((jobId, error, attemptsMade) => {
    console.error(`${serviceName} connector sync job failed`, {
      jobId,
      attemptsMade,
      errorName: error.name,
      errorMessage: error.message,
    });
  });
  workers.contextWarmupWorker.onCompleted((jobId) => {
    console.log(`${serviceName} context warmup job completed`, { jobId });
  });
  workers.contextWarmupWorker.onFailed((jobId, error, attemptsMade) => {
    console.error(`${serviceName} context warmup job failed`, {
      jobId,
      attemptsMade,
      errorName: error.name,
      errorMessage: error.message,
    });
  });
}
