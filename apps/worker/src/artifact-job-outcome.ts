import { RetryableArtifactProcessingError } from "./ingestion-processor.js";

export function classifyArtifactJobError(error: unknown): "retryable" | "fatal" {
  return error instanceof RetryableArtifactProcessingError ? "retryable" : "fatal";
}

export function shouldDeadLetterArtifactJob(input: {
  outcome: "retry" | "dead_letter" | "retry_scheduled" | "will_retry";
}) {
  return input.outcome === "dead_letter";
}
