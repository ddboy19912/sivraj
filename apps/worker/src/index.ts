import "./env.js";
import { resolveDatabaseUrl } from "@sivraj/config";
import { createArtifactProcessingWorker } from "@sivraj/queue";
import { createWorkerDb } from "./db.js";
import {
  processArtifact,
  processQueuedArtifacts,
} from "./ingestion-processor.js";
import { runHealthJob } from "./jobs/health";
import { createConfiguredPrivateMemoryReader } from "./private-memory-reader.js";
import { createDrizzleArtifactRepository } from "./repository.js";

export const serviceName = "sivraj-worker";

async function main() {
  console.log(`${serviceName} booting`);

  await runHealthJob();

  const { db, close } = createWorkerDb(resolveDatabaseUrl(process.env));
  const repository = createDrizzleArtifactRepository(db);
  const privateMemoryReader = createConfiguredPrivateMemoryReader(process.env);
  const redisUrl = readRequired(process.env["REDIS_URL"], "REDIS_URL");
  const concurrency = readPositiveInt(process.env["WORKER_CONCURRENCY"], 2);

  if (process.env["WORKER_DRAIN_EXISTING_ON_BOOT"] !== "false") {
    const result = await processQueuedArtifacts(repository, {
      limit: readPositiveInt(process.env["WORKER_BOOT_DRAIN_LIMIT"], 100),
      privateMemoryReader,
    });

    console.log(`${serviceName} boot drain processed`, result);
  }

  const worker = createArtifactProcessingWorker(
    redisUrl,
    async (data, job) => {
      const result = await processArtifact(repository, data.artifactId, {
        privateMemoryReader,
      });

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
  worker.onFailed((jobId, error) => {
    console.error(`${serviceName} job failed`, { jobId, error });
  });

  console.log(`${serviceName} ready`, {
    queue: "sivraj-artifact-processing",
    concurrency,
  });

  await waitForShutdown();
  await worker.close();
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

function waitForShutdown(): Promise<void> {
  return new Promise((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });
}
