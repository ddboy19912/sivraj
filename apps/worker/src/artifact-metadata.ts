export function artifactMetadata(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function readArtifactProcessingMetadata(metadata: unknown): Record<string, unknown> | undefined {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return undefined;
  }

  const processing = (metadata as Record<string, unknown>)["processing"];

  if (!processing || typeof processing !== "object" || Array.isArray(processing)) {
    return undefined;
  }

  return processing as Record<string, unknown>;
}

export function readProcessingReason(metadata: unknown): string | undefined {
  const reason = readArtifactProcessingMetadata(metadata)?.["reason"];

  return typeof reason === "string" ? reason : undefined;
}

export type IntelligenceStatus = "queued" | "processing" | "completed" | "failed" | "skipped";

const INTELLIGENCE_STATUSES = new Set<IntelligenceStatus>([
  "queued",
  "processing",
  "completed",
  "failed",
  "skipped",
]);

export function readIntelligenceStatus(metadata: unknown): IntelligenceStatus | undefined {
  const intelligence = readArtifactProcessingMetadata(metadata)?.["intelligence"];

  if (!intelligence || typeof intelligence !== "object" || Array.isArray(intelligence)) {
    return undefined;
  }

  const status = (intelligence as Record<string, unknown>)["status"];

  return typeof status === "string" && INTELLIGENCE_STATUSES.has(status as IntelligenceStatus)
    ? status as IntelligenceStatus
    : undefined;
}
