import { asRecord } from "./shared/record.js";

// Reads trimmed non-empty string fields from connector source metadata.

export function readConnectorMetadataString(metadata: unknown, key: string): string | null {
  const value = asRecord(metadata)[key];

  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
