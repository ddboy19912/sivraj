import {
  Queue,
  Worker,
  type ConnectionOptions,
  type Job,
  type JobsOptions,
} from "bullmq";
import IORedis from "ioredis";

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
  onFailed(listener: (jobId: string | undefined, error: Error, attemptsMade: number | undefined) => void): void;
  onCompleted(listener: (jobId: string | undefined) => void): void;
};

export type ArtifactStatusEvent = {
  artifactId: string;
  twinId: string;
  sourceType: string;
  status: "pending" | "queued" | "processing" | "completed" | "failed" | "cancelled";
  reason?: string;
  occurredAt: string;
};

export type ArtifactStatusPublisher = {
  publishArtifactStatus(event: ArtifactStatusEvent): Promise<void>;
  close(): Promise<void>;
};

export type ArtifactStatusSubscriber = {
  subscribeToArtifactStatus(
    artifactId: string,
    listener: (event: ArtifactStatusEvent) => void,
  ): Promise<() => Promise<void>>;
  close(): Promise<void>;
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
        listener(job?.id ? String(job.id) : undefined, error, job?.attemptsMade);
      });
    },
    onCompleted(listener) {
      worker.on("completed", (job) => {
        listener(job?.id ? String(job.id) : undefined);
      });
    },
  };
}

export function createArtifactStatusPublisher(redisUrl: string): ArtifactStatusPublisher {
  const redis = new IORedis(redisUrl, {
    maxRetriesPerRequest: null,
  });

  return {
    async publishArtifactStatus(event) {
      await redis.publish(artifactStatusChannel(event.artifactId), JSON.stringify(event));
    },
    async close() {
      await redis.quit();
    },
  };
}

export function createLazyArtifactStatusPublisher(
  redisUrl: string | undefined,
): ArtifactStatusPublisher | undefined {
  if (!redisUrl) {
    return undefined;
  }

  let publisher: ArtifactStatusPublisher | null = null;

  return {
    async publishArtifactStatus(event) {
      publisher ??= createArtifactStatusPublisher(redisUrl);
      await publisher.publishArtifactStatus(event);
    },
    async close() {
      await publisher?.close();
      publisher = null;
    },
  };
}

export function createArtifactStatusSubscriber(redisUrl: string): ArtifactStatusSubscriber {
  const redis = new IORedis(redisUrl, {
    maxRetriesPerRequest: null,
  });
  const listeners = new Map<string, Set<(event: ArtifactStatusEvent) => void>>();

  redis.on("message", (channel, message) => {
    const channelListeners = listeners.get(channel);

    if (!channelListeners) {
      return;
    }

    const event = parseArtifactStatusEvent(message);

    if (!event) {
      return;
    }

    for (const listener of channelListeners) {
      listener(event);
    }
  });

  return {
    async subscribeToArtifactStatus(artifactId, listener) {
      const channel = artifactStatusChannel(artifactId);
      let channelListeners = listeners.get(channel);

      if (!channelListeners) {
        channelListeners = new Set();
        listeners.set(channel, channelListeners);
        await redis.subscribe(channel);
      }

      channelListeners.add(listener);

      return async () => {
        const currentListeners = listeners.get(channel);

        if (!currentListeners) {
          return;
        }

        currentListeners.delete(listener);

        if (currentListeners.size === 0) {
          listeners.delete(channel);
          await redis.unsubscribe(channel);
        }
      };
    },
    async close() {
      listeners.clear();
      await redis.quit();
    },
  };
}

export function createLazyArtifactStatusSubscriber(
  redisUrl: string | undefined,
): ArtifactStatusSubscriber | undefined {
  if (!redisUrl) {
    return undefined;
  }

  let subscriber: ArtifactStatusSubscriber | null = null;

  return {
    async subscribeToArtifactStatus(artifactId, listener) {
      subscriber ??= createArtifactStatusSubscriber(redisUrl);
      return subscriber.subscribeToArtifactStatus(artifactId, listener);
    },
    async close() {
      await subscriber?.close();
      subscriber = null;
    },
  };
}

function redisConnection(redisUrl: string): ConnectionOptions {
  return { url: redisUrl };
}

function artifactStatusChannel(artifactId: string): string {
  return `sivraj:artifact-status:${artifactId}`;
}

function parseArtifactStatusEvent(message: string): ArtifactStatusEvent | null {
  try {
    const parsed = JSON.parse(message) as Partial<ArtifactStatusEvent>;

    if (
      typeof parsed.artifactId !== "string" ||
      typeof parsed.twinId !== "string" ||
      typeof parsed.sourceType !== "string" ||
      typeof parsed.status !== "string" ||
      typeof parsed.occurredAt !== "string"
    ) {
      return null;
    }

    return parsed as ArtifactStatusEvent;
  } catch {
    return null;
  }
}
