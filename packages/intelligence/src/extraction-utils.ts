import { createHash } from "node:crypto";

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

export function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? Array.from(new Set(value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean)))
    : [];
}

export function clampConfidence(value: number | null): number {
  if (value === null) {
    return 0.5;
  }

  return Math.max(0, Math.min(1, value));
}

export function normalizeStatement(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export function truncateForExtraction(value: string): string {
  return value.length > 30_000 ? value.slice(0, 30_000) : value;
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function sanitizePrimitiveMetadata(value: unknown): Record<string, unknown> {
  const record = asRecord(value);
  const safe: Record<string, unknown> = {};

  for (const [key, item] of Object.entries(record)) {
    if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") {
      safe[key] = item;
    }
  }

  return safe;
}

export function readLlmArrayField(value: unknown, field: string): unknown[] {
  const items = asRecord(value)[field];
  return Array.isArray(items) ? items : [];
}

export function dedupeByConfidence<T extends { confidence: number }>(
  items: Iterable<T>,
  keyFn: (item: T) => string,
  maxItems: number,
): T[] {
  const deduped = new Map<string, T>();

  for (const item of items) {
    const key = keyFn(item);
    const previous = deduped.get(key);

    if (!previous || item.confidence > previous.confidence) {
      deduped.set(key, item);
    }
  }

  return Array.from(deduped.values())
    .sort((left, right) => right.confidence - left.confidence)
    .slice(0, maxItems);
}

const UNSAFE_METADATA_KEY_FRAGMENTS = [
  "evidence",
  "statement",
  "content",
  "text",
  "snippet",
  "quote",
  "raw",
  "secret",
  "private",
  "password",
  "token",
  "key",
  "mnemonic",
  "connection",
] as const;

export const PROFILE_EXACT_BLOCKED_METADATA_KEYS = [
  "archiveMs",
  "batchStorage",
  "candidateMemoryArchiveQueued",
  "confidence",
  "evidenceHash",
  "evidenceLength",
  "extractor",
  "model",
  "normalizedStatementHash",
  "provider",
  "statementCount",
  "statementIndex",
  "storage",
  "storageMode",
  "subject",
] as const;

export type SecureMetadataKeyPolicy = {
  allowAgentContextLine?: boolean;
  exactBlockedKeys?: readonly string[];
};

export function sanitizeSecureMetadata(
  value: unknown,
  policy: SecureMetadataKeyPolicy = {},
): Record<string, unknown> {
  return sanitizeSecureMetadataRecord(value, policy);
}

export function sanitizeSecureMetadataRecord(
  value: unknown,
  policy: SecureMetadataKeyPolicy = {},
): Record<string, unknown> {
  const record = asRecord(value);
  const safe: Record<string, unknown> = {};

  for (const [key, item] of Object.entries(record)) {
    if (isUnsafeSecureMetadataKey(key, policy)) {
      continue;
    }

    if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") {
      if (typeof item === "string" && looksLikeSecretValue(item)) {
        continue;
      }

      safe[key] = item;
    }
  }

  return safe;
}

function isUnsafeSecureMetadataKey(
  key: string,
  policy: SecureMetadataKeyPolicy = {},
): boolean {
  const normalized = key.toLowerCase();

  if (policy.allowAgentContextLine && normalized === "agentcontextline") {
    return false;
  }

  if (policy.exactBlockedKeys?.some((blocked) => normalized === blocked.toLowerCase())) {
    return true;
  }

  return UNSAFE_METADATA_KEY_FRAGMENTS.some((fragment) => normalized.includes(fragment));
}

export function looksLikeSecretValue(value: string): boolean {
  const trimmed = value.trim();

  return /^suiprivkey/i.test(trimmed) ||
    /^sk-[A-Za-z0-9_-]{16,}/.test(trimmed) ||
    (trimmed.length >= 32 && /^[A-Za-z0-9_-]+$/.test(trimmed) && /[A-Z0-9]/.test(trimmed)) ||
    /:\/\/[^:\s]+:[^@\s]+@/.test(trimmed);
}
