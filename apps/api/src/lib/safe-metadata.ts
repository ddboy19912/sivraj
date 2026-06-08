const PLAINTEXT_LIKE_METADATA_KEYS = new Set([
  "body",
  "content",
  "message",
  "note",
  "statement",
  "text",
  "title",
  "filename",
  "file_name",
  "file",
  "path",
  "sourcefile",
  "source_file",
  "summary",
  "transcript",
]);

export function recordMetadata(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function isPrimitiveMetadataValue(
  value: unknown,
): value is string | number | boolean | null {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  );
}

function isPrimitiveMetadataArray(
  value: unknown,
): value is Array<string | number | boolean | null> {
  return Array.isArray(value) && value.every(isPrimitiveMetadataValue);
}

function isPlaintextLikeMetadataKey(key: string): boolean {
  return PLAINTEXT_LIKE_METADATA_KEYS.has(key.toLowerCase());
}

export function sanitizeSafeMetadata(value: unknown): Record<string, unknown> {
  const metadata = recordMetadata(value);
  const sanitized: Record<string, unknown> = {};

  for (const [key, item] of Object.entries(metadata)) {
    const normalizedKey = key.trim();

    if (!normalizedKey || isPlaintextLikeMetadataKey(normalizedKey)) {
      continue;
    }

    if (isPrimitiveMetadataValue(item)) {
      sanitized[normalizedKey] = item;
      continue;
    }

    if (isPrimitiveMetadataArray(item)) {
      sanitized[normalizedKey] = item;
    }
  }

  return sanitized;
}

export function sanitizeStrictSafeMetadata(
  value: unknown,
): Record<string, unknown> | null {
  if (value === undefined || value === null) {
    return {};
  }

  if (typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const metadata: Record<string, unknown> = {};

  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const normalizedKey = key.trim();

    if (!normalizedKey || isPlaintextLikeMetadataKey(normalizedKey)) {
      return null;
    }

    if (isPrimitiveMetadataValue(item)) {
      metadata[normalizedKey] = item;
      continue;
    }

    if (isPrimitiveMetadataArray(item)) {
      metadata[normalizedKey] = item;
      continue;
    }

    return null;
  }

  return metadata;
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
