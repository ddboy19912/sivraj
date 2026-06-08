import type { ArtifactProcessingJobData } from "@sivraj/queue";
import {
  processArtifact,
  RetryableArtifactProcessingError,
} from "./ingestion-processor.js";
import type { createDrizzleArtifactRepository } from "./repository.js";
import type { createConfiguredPrivateMemoryReader } from "@sivraj/private-memory-reader";
import type { createConfiguredPrivateFragmentStorage } from "./private-fragment-storage.js";
import type { createConfiguredSpeechToTextTranscriber } from "@sivraj/llm";
import type { createIntelligenceProcessingQueue } from "@sivraj/queue";

type ArtifactProcessingJobDeps = {
  repository: ReturnType<typeof createDrizzleArtifactRepository>;
  privateMemoryReader: ReturnType<typeof createConfiguredPrivateMemoryReader>;
  privateFragmentStorage: ReturnType<typeof createConfiguredPrivateFragmentStorage>;
  speechToTextTranscriber: ReturnType<typeof createConfiguredSpeechToTextTranscriber> | null;
  intelligenceQueue: ReturnType<typeof createIntelligenceProcessingQueue>;
};

type ArtifactProcessingJob = {
  id?: string;
  attemptsMade: number;
  opts: { attempts?: number };
};

export async function executeArtifactProcessingAttempt(
  deps: ArtifactProcessingJobDeps,
  data: ArtifactProcessingJobData,
  transientCiphertext: { ciphertextBase64: string; ciphertextSha256: string } | null,
) {
  return processArtifact(deps.repository, data.artifactId, {
    privateMemoryReader: deps.privateMemoryReader,
    privateFragmentStorage: deps.privateFragmentStorage,
    speechToTextTranscriber: deps.speechToTextTranscriber ?? undefined,
    intelligenceQueue: deps.intelligenceQueue,
    transientCiphertextBase64: data.transientCiphertextBase64 ?? transientCiphertext?.ciphertextBase64,
    transientCiphertextSha256: data.transientCiphertextSha256 ?? transientCiphertext?.ciphertextSha256,
  });
}

export function isRetryableArtifactJobError(error: unknown): error is RetryableArtifactProcessingError {
  return error instanceof RetryableArtifactProcessingError;
}
