import { resolveDatabaseUrl } from "@sivraj/config";
import {
  createConfiguredSpeechToTextTranscriber,
  createConfiguredStructuredGenerator,
  createConfiguredTextEmbedder,
} from "@sivraj/llm";
import { createIntelligenceProcessingQueue } from "@sivraj/queue";
import { createPrivateMemoryCiphertextCache } from "@sivraj/queue";
import { createWorkerDb } from "./db.js";
import {
  createCanonicalMemoryMergeJudge,
  createEntityExtractor,
  createEngineeringMemoryExtractor,
  createMemoryExtractor,
  processQueuedArtifacts,
} from "./ingestion-processor.js";
import { createConfiguredPrivateMemoryReader } from "@sivraj/private-memory-reader";
import { createConfiguredPrivateFragmentStorage } from "./private-fragment-storage.js";
import { createConfiguredPrivateSourceStorage } from "./private-source-storage.js";
import { createDrizzleArtifactRepository } from "./repository.js";
import { readPositiveInt } from "./lib/env-utils.js";
import type { WorkerBootstrapInput } from "./worker-bootstrap.js";

function readRequired(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export async function startWorker(serviceName: string): Promise<void> {
  console.log(`${serviceName} booting`);

  const { runHealthJob } = await import("./jobs/health.js");
  await runHealthJob();

  const bootstrapInput = await prepareWorkerBootstrapInput(serviceName);
  const { createWorkerRuntime } = await import("./worker-bootstrap.js");
  const runtime = createWorkerRuntime(bootstrapInput);

  console.log(`${serviceName} ready`, {
    queue: "sivraj-artifact-processing",
    intelligenceQueue: "sivraj-intelligence-processing",
    candidateMemoryArchiveQueue: "sivraj-candidate-memory-archive",
    weeklyReflectionQueue: "sivraj-weekly-reflection",
    connectorSyncQueue: "sivraj-connector-sync",
    contextWarmupQueue: "sivraj-context-warmup",
    concurrency: bootstrapInput.concurrency,
    entityExtraction: bootstrapInput.entityExtractor ? "enabled" : "disabled",
    memoryExtraction: bootstrapInput.memoryExtractor ? "enabled" : "disabled",
    semanticMemoryConsolidation: bootstrapInput.canonicalMemoryMergeJudge ? "enabled" : "disabled",
    intelligenceChunkChars: bootstrapInput.intelligenceChunkChars,
    intelligenceChunkConcurrency: bootstrapInput.intelligenceChunkConcurrency,
    artifactReconcileIntervalMs: bootstrapInput.artifactReconcileIntervalMs,
    artifactReconcileLimit: bootstrapInput.artifactReconcileLimit,
    connectorReconcileIntervalMs: bootstrapInput.connectorReconcileIntervalMs,
    connectorReconcileLimit: bootstrapInput.connectorReconcileLimit,
    candidateMemoryArchiveReconcileIntervalMs: bootstrapInput.candidateMemoryArchiveReconcileIntervalMs,
    candidateMemoryArchiveReconcileLimit: bootstrapInput.candidateMemoryArchiveReconcileLimit,
    memoryRenewalIntervalMs: bootstrapInput.memoryRenewalIntervalMs,
    memoryRenewalLimit: bootstrapInput.memoryRenewalLimit,
    llmModel: process.env["LLM_MODEL"] || null,
    llmBaseUrl: process.env["OPENAI_BASE_URL"] || "https://api.openai.com",
  });

  await waitForShutdown();
  await runtime.close();
}

function waitForShutdown(): Promise<void> {
  return new Promise((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });
}

export async function prepareWorkerBootstrapInput(serviceName: string): Promise<WorkerBootstrapInput> {
  const { db, close } = createWorkerDb(resolveDatabaseUrl(process.env));
  const repository = createDrizzleArtifactRepository(db);
  const redisUrl = readRequired(process.env["REDIS_URL"], "REDIS_URL");
  const privateMemoryCiphertextCache = createPrivateMemoryCiphertextCache(redisUrl);
  const privateMemoryReader = createConfiguredPrivateMemoryReader(process.env, {
    ciphertextCache: privateMemoryCiphertextCache,
  });
  const privateFragmentStorage = createConfiguredPrivateFragmentStorage(process.env);
  const privateSourceStorage = createConfiguredPrivateSourceStorage(process.env);
  const speechToTextTranscriber = createConfiguredSpeechToTextTranscriber(process.env);
  const textEmbedder = createConfiguredTextEmbedder(process.env);
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
  const intelligenceQueue = createIntelligenceProcessingQueue(redisUrl);

  if (process.env["WORKER_DRAIN_EXISTING_ON_BOOT"] !== "false") {
    const result = await processQueuedArtifacts(repository, {
      limit: readPositiveInt(process.env["WORKER_BOOT_DRAIN_LIMIT"], 100),
      privateMemoryReader,
      privateFragmentStorage,
      speechToTextTranscriber: speechToTextTranscriber ?? undefined,
      textEmbedder: textEmbedder ?? undefined,
      intelligenceQueue,
    });

    console.log(`${serviceName} boot drain processed`, result);
    await intelligenceQueue.close();
  }

  return {
    serviceName,
    db,
    closeDb: close,
    repository,
    privateMemoryCiphertextCache,
    privateMemoryReader,
    privateFragmentStorage,
    privateSourceStorage,
    speechToTextTranscriber,
    textEmbedder,
    structuredGenerator,
    entityExtractor,
    memoryExtractor,
    engineeringMemoryExtractor,
    canonicalMemoryMergeJudge,
    redisUrl,
    concurrency: readPositiveInt(process.env["WORKER_CONCURRENCY"], 2),
    intelligenceChunkChars: readPositiveInt(process.env["INTELLIGENCE_CHUNK_CHARS"], 18_000),
    intelligenceChunkConcurrency: readPositiveInt(process.env["INTELLIGENCE_CHUNK_CONCURRENCY"], 2),
    artifactReconcileIntervalMs: readPositiveInt(process.env["ARTIFACT_RECONCILE_INTERVAL_MS"], 60_000),
    artifactReconcileLimit: readPositiveInt(process.env["ARTIFACT_RECONCILE_LIMIT"], 25),
    connectorReconcileIntervalMs: readPositiveInt(process.env["CONNECTOR_RECONCILE_INTERVAL_MS"], 60_000),
    connectorReconcileLimit: readPositiveInt(process.env["CONNECTOR_RECONCILE_LIMIT"], 25),
    candidateMemoryArchiveReconcileIntervalMs: readPositiveInt(
      process.env["CANDIDATE_MEMORY_ARCHIVE_RECONCILE_INTERVAL_MS"],
      60_000,
    ),
    candidateMemoryArchiveReconcileLimit: readPositiveInt(
      process.env["CANDIDATE_MEMORY_ARCHIVE_RECONCILE_LIMIT"],
      25,
    ),
    memoryRenewalIntervalMs: readPositiveInt(process.env["MEMORY_RENEWAL_RECONCILE_INTERVAL_MS"], 6 * 60 * 60 * 1000),
    memoryRenewalLimit: readPositiveInt(process.env["MEMORY_RENEWAL_RECONCILE_LIMIT"], 25),
  };
}
