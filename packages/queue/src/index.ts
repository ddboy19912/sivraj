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
export const INTELLIGENCE_PROCESSING_QUEUE_NAME = "sivraj-intelligence-processing";
export const PROCESS_INTELLIGENCE_JOB_NAME = "process-intelligence";
export const CANDIDATE_MEMORY_ARCHIVE_QUEUE_NAME = "sivraj-candidate-memory-archive";
export const ARCHIVE_CANDIDATE_MEMORY_JOB_NAME = "archive-candidate-memory";
export const WEEKLY_REFLECTION_QUEUE_NAME = "sivraj-weekly-reflection";
export const GENERATE_WEEKLY_REFLECTION_JOB_NAME = "generate-weekly-reflection";
export const CONNECTOR_SYNC_QUEUE_NAME = "sivraj-connector-sync";
export const SYNC_CONNECTOR_JOB_NAME = "sync-connector";

export type ArtifactProcessingJobData = {
  artifactId: string;
  twinId: string;
  sourceType: string;
  jobKey?: string;
  delayMs?: number;
  transientCiphertextBase64?: string;
  transientCiphertextSha256?: string;
};

export type IntelligenceProcessingJobData = {
  artifactId: string;
  twinId: string;
  memoryFragmentId: string;
  sourceType: string;
  transientFragmentCiphertextBase64?: string;
  transientFragmentCiphertextSha256?: string;
};

export type CandidateMemoryArchiveJobData = {
  artifactId: string;
  twinId: string;
  memoryFragmentId: string;
  sourceType: string;
  candidateMemoryIds: string[];
  encryptedBytesBase64: string;
  contentSha256: string;
  metadata: Record<string, unknown>;
};

export type WeeklyReflectionJobData = {
  reflectionRunId: string;
  twinId: string;
  periodStart: string;
  periodEnd: string;
};

export type ConnectorSyncJobData = {
  syncRunId: string;
  twinId: string;
  connectorAccountId: string;
  connectorSourceId?: string | null;
  provider: string;
  mode: "initial" | "incremental" | "manual";
};

export type ArtifactProcessingQueue = {
  enqueueArtifactProcessing(data: ArtifactProcessingJobData): Promise<{ jobId: string }>;
  close(): Promise<void>;
};

export type TransientCiphertextCache = {
  putArtifactCiphertext(input: {
    artifactId: string;
    ciphertextBase64: string;
    ciphertextSha256: string;
    ttlSeconds?: number;
  }): Promise<void>;
  getArtifactCiphertext(artifactId: string): Promise<{
    ciphertextBase64: string;
    ciphertextSha256: string;
  } | null>;
  close(): Promise<void>;
};

export type IntelligenceProcessingQueue = {
  enqueueIntelligenceProcessing(data: IntelligenceProcessingJobData): Promise<{ jobId: string }>;
  close(): Promise<void>;
};

export type CandidateMemoryArchiveQueue = {
  enqueueCandidateMemoryArchive(data: CandidateMemoryArchiveJobData): Promise<{ jobId: string }>;
  close(): Promise<void>;
};

export type WeeklyReflectionQueue = {
  enqueueWeeklyReflection(data: WeeklyReflectionJobData): Promise<{ jobId: string }>;
  close(): Promise<void>;
};

export type ConnectorSyncQueue = {
  enqueueConnectorSync(data: ConnectorSyncJobData): Promise<{ jobId: string }>;
  close(): Promise<void>;
};

export type ArtifactProcessingWorker = {
  close(): Promise<void>;
  onFailed(listener: (jobId: string | undefined, error: Error, attemptsMade: number | undefined) => void): void;
  onCompleted(listener: (jobId: string | undefined) => void): void;
};

export type IntelligenceProcessingWorker = ArtifactProcessingWorker;
export type CandidateMemoryArchiveWorker = ArtifactProcessingWorker;
export type WeeklyReflectionWorker = ArtifactProcessingWorker;
export type ConnectorSyncWorker = ArtifactProcessingWorker;

export type ArtifactStatusEvent = {
  artifactId: string;
  twinId: string;
  sourceType: string;
  status: "pending" | "queued" | "processing" | "completed" | "failed" | "cancelled";
  intelligenceStatus?: "queued" | "processing" | "completed" | "failed" | "skipped";
  intelligenceStage?: "entity_extraction" | "memory_extraction";
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
        delay: data.delayMs,
        jobId: artifactProcessingJobId(data),
      });

      return { jobId: String(job.id) };
    },
    async close() {
      await queue.close();
    },
  };
}

export function createIntelligenceProcessingQueue(redisUrl: string): IntelligenceProcessingQueue {
  const queue = new Queue<IntelligenceProcessingJobData>(INTELLIGENCE_PROCESSING_QUEUE_NAME, {
    connection: redisConnection(redisUrl),
    defaultJobOptions: artifactJobOptions,
  });

  return {
    async enqueueIntelligenceProcessing(data) {
      const job = await queue.add(PROCESS_INTELLIGENCE_JOB_NAME, data, {
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

export function createCandidateMemoryArchiveQueue(redisUrl: string): CandidateMemoryArchiveQueue {
  const queue = new Queue<CandidateMemoryArchiveJobData>(CANDIDATE_MEMORY_ARCHIVE_QUEUE_NAME, {
    connection: redisConnection(redisUrl),
    defaultJobOptions: {
      ...artifactJobOptions,
      priority: 10,
    },
  });

  return {
    async enqueueCandidateMemoryArchive(data) {
      const job = await queue.add(ARCHIVE_CANDIDATE_MEMORY_JOB_NAME, data, {
        ...artifactJobOptions,
        priority: 10,
        jobId: `${data.artifactId}:candidate-memory-archive:${data.contentSha256.slice(0, 16)}`,
      });

      return { jobId: String(job.id) };
    },
    async close() {
      await queue.close();
    },
  };
}

export function createWeeklyReflectionQueue(redisUrl: string): WeeklyReflectionQueue {
  const queue = new Queue<WeeklyReflectionJobData>(WEEKLY_REFLECTION_QUEUE_NAME, {
    connection: redisConnection(redisUrl),
    defaultJobOptions: artifactJobOptions,
  });

  return {
    async enqueueWeeklyReflection(data) {
      const job = await queue.add(GENERATE_WEEKLY_REFLECTION_JOB_NAME, data, {
        ...artifactJobOptions,
        jobId: data.reflectionRunId,
      });

      return { jobId: String(job.id) };
    },
    async close() {
      await queue.close();
    },
  };
}

export function createConnectorSyncQueue(redisUrl: string): ConnectorSyncQueue {
  const queue = new Queue<ConnectorSyncJobData>(CONNECTOR_SYNC_QUEUE_NAME, {
    connection: redisConnection(redisUrl),
    defaultJobOptions: artifactJobOptions,
  });

  return {
    async enqueueConnectorSync(data) {
      const job = await queue.add(SYNC_CONNECTOR_JOB_NAME, data, {
        ...artifactJobOptions,
        jobId: data.syncRunId,
      });

      return { jobId: String(job.id) };
    },
    async close() {
      await queue.close();
    },
  };
}

export function createLazyConnectorSyncQueue(
  redisUrl: string | undefined,
): ConnectorSyncQueue | undefined {
  if (!redisUrl) {
    return undefined;
  }

  let queue: ConnectorSyncQueue | null = null;

  return {
    async enqueueConnectorSync(data) {
      queue ??= createConnectorSyncQueue(redisUrl);
      return queue.enqueueConnectorSync(data);
    },
    async close() {
      await queue?.close();
      queue = null;
    },
  };
}

export function createLazyWeeklyReflectionQueue(
  redisUrl: string | undefined,
): WeeklyReflectionQueue | undefined {
  if (!redisUrl) {
    return undefined;
  }

  let queue: WeeklyReflectionQueue | null = null;

  return {
    async enqueueWeeklyReflection(data) {
      queue ??= createWeeklyReflectionQueue(redisUrl);
      return queue.enqueueWeeklyReflection(data);
    },
    async close() {
      await queue?.close();
      queue = null;
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

export function createTransientCiphertextCache(redisUrl: string): TransientCiphertextCache {
  const redis = new IORedis(redisUrl, {
    maxRetriesPerRequest: null,
  });

  return {
    async putArtifactCiphertext(input) {
      await redis.set(
        transientArtifactCiphertextKey(input.artifactId),
        JSON.stringify({
          ciphertextBase64: input.ciphertextBase64,
          ciphertextSha256: input.ciphertextSha256,
        }),
        "EX",
        input.ttlSeconds ?? 60 * 60,
      );
    },
    async getArtifactCiphertext(artifactId) {
      const value = await redis.get(transientArtifactCiphertextKey(artifactId));

      if (!value) {
        return null;
      }

      try {
        const parsed = JSON.parse(value) as Partial<{
          ciphertextBase64: string;
          ciphertextSha256: string;
        }>;

        return typeof parsed.ciphertextBase64 === "string" &&
          typeof parsed.ciphertextSha256 === "string"
          ? {
              ciphertextBase64: parsed.ciphertextBase64,
              ciphertextSha256: parsed.ciphertextSha256,
            }
          : null;
      } catch {
        return null;
      }
    },
    async close() {
      await redis.quit();
    },
  };
}

export function createLazyTransientCiphertextCache(
  redisUrl: string | undefined,
): TransientCiphertextCache | undefined {
  if (!redisUrl) {
    return undefined;
  }

  let cache: TransientCiphertextCache | null = null;

  return {
    async putArtifactCiphertext(input) {
      cache ??= createTransientCiphertextCache(redisUrl);
      await cache.putArtifactCiphertext(input);
    },
    async getArtifactCiphertext(artifactId) {
      cache ??= createTransientCiphertextCache(redisUrl);
      return cache.getArtifactCiphertext(artifactId);
    },
    async close() {
      await cache?.close();
      cache = null;
    },
  };
}

function createQueueWorker<T>(
  queueName: string,
  redisUrl: string,
  processor: (data: T, job: Job<T>) => Promise<void>,
  options: { concurrency?: number } = {},
): ArtifactProcessingWorker {
  const worker = new Worker<T>(
    queueName,
    async (job: Job<T>) => {
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
      worker.on("failed", (job: Job<T> | undefined, error) => {
        listener(job?.id ? String(job.id) : undefined, error, job?.attemptsMade);
      });
    },
    onCompleted(listener) {
      worker.on("completed", (job: Job<T>) => {
        listener(job?.id ? String(job.id) : undefined);
      });
    },
  };
}

export function createArtifactProcessingWorker(
  redisUrl: string,
  processor: (data: ArtifactProcessingJobData, job: Job<ArtifactProcessingJobData>) => Promise<void>,
  options: { concurrency?: number } = {},
): ArtifactProcessingWorker {
  return createQueueWorker(ARTIFACT_PROCESSING_QUEUE_NAME, redisUrl, processor, options);
}

export function createIntelligenceProcessingWorker(
  redisUrl: string,
  processor: (data: IntelligenceProcessingJobData, job: Job<IntelligenceProcessingJobData>) => Promise<void>,
  options: { concurrency?: number } = {},
): IntelligenceProcessingWorker {
  return createQueueWorker(INTELLIGENCE_PROCESSING_QUEUE_NAME, redisUrl, processor, options);
}

export function createCandidateMemoryArchiveWorker(
  redisUrl: string,
  processor: (data: CandidateMemoryArchiveJobData, job: Job<CandidateMemoryArchiveJobData>) => Promise<void>,
  options: { concurrency?: number } = {},
): CandidateMemoryArchiveWorker {
  return createQueueWorker(
    CANDIDATE_MEMORY_ARCHIVE_QUEUE_NAME,
    redisUrl,
    processor,
    { concurrency: options.concurrency ?? 1 },
  );
}

export function createWeeklyReflectionWorker(
  redisUrl: string,
  processor: (data: WeeklyReflectionJobData, job: Job<WeeklyReflectionJobData>) => Promise<void>,
  options: { concurrency?: number } = {},
): WeeklyReflectionWorker {
  return createQueueWorker(
    WEEKLY_REFLECTION_QUEUE_NAME,
    redisUrl,
    processor,
    { concurrency: options.concurrency ?? 1 },
  );
}

export function createConnectorSyncWorker(
  redisUrl: string,
  processor: (data: ConnectorSyncJobData, job: Job<ConnectorSyncJobData>) => Promise<void>,
  options: { concurrency?: number } = {},
): ConnectorSyncWorker {
  return createQueueWorker(
    CONNECTOR_SYNC_QUEUE_NAME,
    redisUrl,
    processor,
    { concurrency: options.concurrency ?? 1 },
  );
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

function transientArtifactCiphertextKey(artifactId: string): string {
  return `sivraj:artifact-ciphertext:${artifactId}`;
}

function artifactProcessingJobId(data: ArtifactProcessingJobData): string {
  return data.jobKey
    ? `${data.artifactId}-${data.jobKey.replace(/[^a-zA-Z0-9_-]/g, "-")}`
    : data.artifactId;
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
