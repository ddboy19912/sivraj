import {
  Queue,
  Worker,
  type ConnectionOptions,
  type Job,
  type JobsOptions,
} from "bullmq";

export const ARTIFACT_PROCESSING_QUEUE_NAME = "sivraj-artifact-processing";
export const PROCESS_ARTIFACT_JOB_NAME = "process-artifact";

export type ArtifactProcessingJobData = {
  artifactId: string;
  twinId: string;
  sourceType: string;
};

export type ArtifactProcessingQueue = {
  enqueueArtifactProcessing(data: ArtifactProcessingJobData): Promise<{ jobId: string }>;
  close(): Promise<void>;
};

export type ArtifactProcessingWorker = {
  close(): Promise<void>;
  onFailed(listener: (jobId: string | undefined, error: Error) => void): void;
  onCompleted(listener: (jobId: string | undefined) => void): void;
};

const artifactJobOptions: JobsOptions = {
  attempts: 3,
  backoff: {
    type: "exponential",
    delay: 5000,
  },
  removeOnComplete: 1000,
  removeOnFail: false,
};

export function createArtifactProcessingQueue(redisUrl: string): ArtifactProcessingQueue {
  const queue = new Queue<ArtifactProcessingJobData>(ARTIFACT_PROCESSING_QUEUE_NAME, {
    connection: redisConnection(redisUrl),
    defaultJobOptions: artifactJobOptions,
  });

  return {
    async enqueueArtifactProcessing(data) {
      const job = await queue.add(PROCESS_ARTIFACT_JOB_NAME, data, {
        ...artifactJobOptions,
        jobId: data.artifactId,
      });

      return { jobId: String(job.id) };
    },
    async close() {
      await queue.close();
    },
  };
}

export function createLazyArtifactProcessingQueue(
  redisUrl: string | undefined,
): ArtifactProcessingQueue | undefined {
  if (!redisUrl) {
    return undefined;
  }

  let queue: ArtifactProcessingQueue | null = null;

  return {
    async enqueueArtifactProcessing(data) {
      queue ??= createArtifactProcessingQueue(redisUrl);
      return queue.enqueueArtifactProcessing(data);
    },
    async close() {
      await queue?.close();
      queue = null;
    },
  };
}

export function createArtifactProcessingWorker(
  redisUrl: string,
  processor: (data: ArtifactProcessingJobData, job: Job<ArtifactProcessingJobData>) => Promise<void>,
  options: { concurrency?: number } = {},
): ArtifactProcessingWorker {
  const worker = new Worker<ArtifactProcessingJobData>(
    ARTIFACT_PROCESSING_QUEUE_NAME,
    async (job) => {
      await processor(job.data, job);
    },
    {
      connection: redisConnection(redisUrl),
      concurrency: options.concurrency ?? 2,
    },
  );

  return {
    async close() {
      await worker.close();
    },
    onFailed(listener) {
      worker.on("failed", (job, error) => {
        listener(job?.id ? String(job.id) : undefined, error);
      });
    },
    onCompleted(listener) {
      worker.on("completed", (job) => {
        listener(job?.id ? String(job.id) : undefined);
      });
    },
  };
}

function redisConnection(redisUrl: string): ConnectionOptions {
  return { url: redisUrl };
}
