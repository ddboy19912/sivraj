export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function readMetadataString(metadata: unknown, key: string): string | null {
  const value = asRecord(metadata)[key];

  return typeof value === "string" ? value : null;
}

export function readCiphertextSha256(metadata: unknown): string | null {
  return readMetadataString(metadata, "ciphertextSha256");
}
