export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown decrypt error";
}

export class RetryableArtifactProcessingError extends Error {
  readonly artifactId: string;
  readonly reason: string;
  readonly detail: string;

  constructor(params: {
    artifactId: string;
    reason: string;
    detail: string;
  }) {
    super(params.detail);
    this.name = "RetryableArtifactProcessingError";
    this.artifactId = params.artifactId;
    this.reason = params.reason;
    this.detail = params.detail;
  }
}
