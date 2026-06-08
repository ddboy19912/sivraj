import { asRecord } from "./metadata-utils.js";

export function withProcessingState(
  metadata: Record<string, unknown>,
  processing: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...metadata,
    processing,
  };
}

export function withIntelligenceState(
  metadata: Record<string, unknown>,
  intelligence: Record<string, unknown>,
): Record<string, unknown> {
  const processing = asRecord(metadata["processing"]);

  return {
    ...metadata,
    processing: {
      ...processing,
      intelligence,
    },
  };
}
