import { describe, expect, it } from "vitest";
import { artifactMetadata } from "./artifact-metadata.js";
import { isRetryableArtifactJobError } from "./artifact-job-runner.js";
import { classifyArtifactJobError } from "./artifact-job-outcome.js";
import {
  createArtifactProcessingJobHandler,
  nextAutomaticRetry,
} from "./artifact-processing-job.js";
import { RetryableArtifactProcessingError } from "./ingestion-processor.js";

describe("nextAutomaticRetry", () => {
  it("schedules exponential backoff retries", () => {
    const first = nextAutomaticRetry({});
    expect(first).toMatchObject({ count: 1, delayMs: 30_000 });

    const second = nextAutomaticRetry({
      processing: { autoRetryCount: 1 },
    });
    expect(second).toMatchObject({ count: 2, delayMs: 120_000 });

    const exhausted = nextAutomaticRetry({
      processing: { autoRetryCount: 5 },
    });
    expect(exhausted).toBeNull();
  });

  it("reads retry count from processing metadata", () => {
    const metadata = artifactMetadata({
      processing: { autoRetryCount: 3 },
    });
    expect(nextAutomaticRetry(metadata)?.count).toBe(4);
  });
});

describe("createArtifactProcessingJobHandler", () => {
  it("classifies retryable artifact job errors", () => {
    expect(isRetryableArtifactJobError(new RetryableArtifactProcessingError("retry"))).toBe(true);
    expect(classifyArtifactJobError(new RetryableArtifactProcessingError("retry"))).toBe("retryable");
    expect(createArtifactProcessingJobHandler).toBeTypeOf("function");
  });
});

