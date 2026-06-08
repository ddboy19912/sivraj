export function readMergeDecision(value: unknown): "same" | "related" | "conflicting" | "separate" {
  return value === "same" || value === "related" || value === "conflicting" || value === "separate"
    ? value
    : "separate";
}

export function clampConfidence(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(1, value));
}

import { asRecord } from "./metadata-utils.js";

export function parseCanonicalMemoryMergeResponse<
  TExisting extends { id: string },
>(
  json: unknown,
  existing: TExisting[],
): {
  decision: "same" | "related" | "conflicting" | "separate";
  canonicalMemoryId: string | null;
  confidence: number;
  reason: string;
} {
  const record = asRecord(json);
  const decision = readMergeDecision(record.decision);
  const canonicalMemoryId = typeof record.canonicalMemoryId === "string"
    ? record.canonicalMemoryId
    : null;
  const confidence = clampConfidence(record.confidence);
  const reason = typeof record.reason === "string" && record.reason.trim()
    ? record.reason.trim().slice(0, 500)
    : "No reason provided.";
  const matchedId = canonicalMemoryId && existing.some((memory) => memory.id === canonicalMemoryId)
    ? canonicalMemoryId
    : null;

  if (decision === "same" && !matchedId) {
    return {
      decision: "separate",
      canonicalMemoryId: null,
      confidence: 0,
      reason: "Merge judge returned an unknown canonical memory id.",
    };
  }

  return {
    decision,
    canonicalMemoryId: decision === "same" || decision === "related" || decision === "conflicting"
      ? matchedId
      : null,
    confidence,
    reason,
  };
}
