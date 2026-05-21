import "./env.js";
import { resolveDatabaseUrl } from "@sivraj/config";
import { sourceArtifacts, type Db } from "@sivraj/db";
import { createConfiguredSpeechToTextTranscriber } from "@sivraj/llm";
import { createArtifactProcessingWorker, createArtifactStatusPublisher } from "@sivraj/queue";
import { eq } from "drizzle-orm";
import { createWorkerDb } from "./db.js";
import {
  processArtifact,
  processQueuedArtifacts,
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
  const redisUrl = readRequired(process.env["REDIS_URL"], "REDIS_URL");
  const artifactStatusPublisher = createArtifactStatusPublisher(redisUrl);
  const concurrency = readPositiveInt(process.env["WORKER_CONCURRENCY"], 2);

  if (process.env["WORKER_DRAIN_EXISTING_ON_BOOT"] !== "false") {
    const result = await processQueuedArtifacts(repository, {
      limit: readPositiveInt(process.env["WORKER_BOOT_DRAIN_LIMIT"], 100),
      privateMemoryReader,
      privateFragmentStorage,
      speechToTextTranscriber: speechToTextTranscriber ?? undefined,
    });

    console.log(`${serviceName} boot drain processed`, result);
  }

  const worker = createArtifactProcessingWorker(
    redisUrl,
    async (data, job) => {
      let result: Awaited<ReturnType<typeof processArtifact>>;

      try {
        result = await processArtifact(repository, data.artifactId, {
          privateMemoryReader,
          privateFragmentStorage,
          speechToTextTranscriber: speechToTextTranscriber ?? undefined,
        });
      } catch (error) {
        if (error instanceof RetryableArtifactProcessingError) {
          console.warn(`${serviceName} retryable artifact processing failure`, {
            jobId: job.id,
            artifactId: data.artifactId,
            attempt: job.attemptsMade + 1,
            attempts: job.opts.attempts,
            reason: error.reason,
            detail: error.detail,
          });

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

  console.log(`${serviceName} ready`, {
    queue: "sivraj-artifact-processing",
    concurrency,
  });

  await waitForShutdown();
  await worker.close();
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

function waitForShutdown(): Promise<void> {
  return new Promise((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });
}
