import { describe, expect, it } from "vitest";
import { RetryableArtifactProcessingError } from "./ingestion-processor.js";
import {
  classifyArtifactJobError,
  shouldDeadLetterArtifactJob,
} from "./artifact-job-outcome.js";

describe("artifact job outcome helpers", () => {
  it("classifies retryable artifact errors", () => {
    expect(classifyArtifactJobError(new RetryableArtifactProcessingError("retry"))).toBe("retryable");
    expect(classifyArtifactJobError(new Error("fatal"))).toBe("fatal");
  });

  it("detects dead letter outcomes", () => {
    expect(shouldDeadLetterArtifactJob({ outcome: "dead_letter" })).toBe(true);
    expect(shouldDeadLetterArtifactJob({ outcome: "retry" })).toBe(false);
  });
});
