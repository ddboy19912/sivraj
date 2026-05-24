const PLAINTEXT_LIKE_METADATA_KEYS = new Set([
  "body",
  "content",
  "message",
  "note",
  "statement",
  "text",
  "title",
  "summary",
  "transcript",
]);

export function recordMetadata(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function sanitizeSafeMetadata(value: unknown): Record<string, unknown> {
  const metadata = recordMetadata(value);
  const sanitized: Record<string, unknown> = {};

  for (const [key, item] of Object.entries(metadata)) {
    const normalizedKey = key.trim();

    if (
      !normalizedKey ||
      PLAINTEXT_LIKE_METADATA_KEYS.has(normalizedKey.toLowerCase())
    ) {
      continue;
    }

    if (
      typeof item === "string" ||
      typeof item === "number" ||
      typeof item === "boolean" ||
      item === null
    ) {
      sanitized[normalizedKey] = item;
      continue;
    }

    if (
      Array.isArray(item) &&
      item.every(
        (arrayItem) =>
          typeof arrayItem === "string" ||
          typeof arrayItem === "number" ||
          typeof arrayItem === "boolean" ||
          arrayItem === null,
      )
    ) {
      sanitized[normalizedKey] = item;
    }
  }

  return sanitized;
}

export function metadataContainsPlaintextLikeFields(value: unknown): boolean {
  const metadata = recordMetadata(value);

  for (const key of Object.keys(metadata)) {
    if (PLAINTEXT_LIKE_METADATA_KEYS.has(key.toLowerCase())) {
      return true;
    }
  }

  return false;
}

export function readProcessingMetadata(
  metadata: unknown,
): Record<string, unknown> {
  return sanitizeSafeMetadata(recordMetadata(metadata)["processing"]);
}

export function readIntelligenceMetadata(
  metadata: unknown,
): Record<string, unknown> {
  const processing = recordMetadata(metadata)["processing"];
  return sanitizeSafeMetadata(recordMetadata(processing)["intelligence"]);
}

export function readIntelligenceStatus(
  metadata: unknown,
): "queued" | "processing" | "completed" | "failed" | "skipped" | undefined {
  const intelligence = recordMetadata(
    recordMetadata(recordMetadata(metadata)["processing"])["intelligence"],
  );
  const status = intelligence["status"];

  return status === "queued" ||
    status === "processing" ||
    status === "completed" ||
    status === "failed" ||
    status === "skipped"
    ? status
    : undefined;
}

export function readProcessingReason(metadata: unknown): string | undefined {
  const processing = recordMetadata(recordMetadata(metadata)["processing"]);
  const reason = processing["reason"];

  return typeof reason === "string" ? reason : undefined;
}
