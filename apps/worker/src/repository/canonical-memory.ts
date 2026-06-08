import type { candidateMemories } from "@sivraj/db";
import { mergeStringArrays, readStringArray } from "./helpers.js";

type CandidateMemoryRow = typeof candidateMemories.$inferSelect;

export function normalizeCanonicalText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, "_");
}

export function canonicalSubjectMatchScore(subject: string | null, normalizedSubject: string): number {
  if (!subject) {
    return 0;
  }

  const normalized = normalizeCanonicalText(subject);

  if (normalized === normalizedSubject) {
    return 3;
  }

  if (normalized.includes(normalizedSubject) || normalizedSubject.includes(normalized)) {
    return 2;
  }

  return 0;
}

export function rankCanonicalMergeCandidates<
  T extends { subject: string | null; updatedAt: Date | null },
>(rows: T[], subject: string | null): T[] {
  if (!subject) {
    return rows;
  }

  const normalizedSubject = normalizeCanonicalText(subject);

  return [...rows].sort((a, b) => {
    const aScore = canonicalSubjectMatchScore(a.subject, normalizedSubject);
    const bScore = canonicalSubjectMatchScore(b.subject, normalizedSubject);

    if (aScore !== bScore) {
      return bScore - aScore;
    }

    return (b.updatedAt?.getTime() ?? 0) - (a.updatedAt?.getTime() ?? 0);
  });
}

export function buildCanonicalMemoryKey(
  memoryType: CandidateMemoryRow["memoryType"],
  metadata: Record<string, unknown>,
  subject: string | null,
): string {
  const category = asRecord(metadata.memoryMetadata).category;
  const normalizedStatementHash = metadata.normalizedStatementHash;

  if (subject) {
    return [
      "subject",
      memoryType,
      normalizeCanonicalText(subject),
      typeof category === "string" && category.trim()
        ? normalizeCanonicalText(category)
        : "general",
    ].join(":");
  }

  if (typeof normalizedStatementHash === "string" && normalizedStatementHash.trim()) {
    return ["statement", memoryType, normalizedStatementHash.trim().toLowerCase()].join(":");
  }

  const evidenceHash = metadata.evidenceHash;
  return ["evidence", memoryType, typeof evidenceHash === "string" ? evidenceHash : "unknown"].join(":");
}

export function mergeCanonicalMemoryMetadata(
  existingMetadata: unknown,
  incomingMetadata: unknown,
  evidence: {
    sourceArtifactId: string;
    memoryFragmentId: string;
    evidenceHash: string;
    semanticMerge?: {
      decision: "same" | "related" | "conflicting" | "separate";
      canonicalMemoryId: string | null;
      confidence: number;
      reason: string;
    };
  },
): Record<string, unknown> {
  const existing = asRecord(existingMetadata);
  const incoming = asRecord(incomingMetadata);
  const evidenceHashes = mergeStringArrays(
    readStringArray(existing.evidenceHashes),
    [evidence.evidenceHash],
  );
  const sourceArtifactIds = mergeStringArrays(
    readStringArray(existing.sourceArtifactIds),
    [evidence.sourceArtifactId],
  );
  const memoryFragmentIds = mergeStringArrays(
    readStringArray(existing.memoryFragmentIds),
    [evidence.memoryFragmentId],
  );

  return {
    ...existing,
    subject: incoming.subject ?? existing.subject,
    sourceType: incoming.sourceType ?? existing.sourceType,
    memoryMetadata: incoming.memoryMetadata ?? existing.memoryMetadata,
    consolidationMethod: evidence.semanticMerge?.decision === "same"
      ? "llm_semantic_merge_judgment"
      : "deterministic_subject_or_statement_key",
    ...(evidence.semanticMerge
      ? {
          lastSemanticMerge: {
            decision: evidence.semanticMerge.decision,
            canonicalMemoryId: evidence.semanticMerge.canonicalMemoryId,
            confidence: evidence.semanticMerge.confidence,
            reason: evidence.semanticMerge.reason,
          },
        }
      : {}),
    evidenceHashes,
    sourceArtifactIds,
    memoryFragmentIds,
    evidenceCount: evidenceHashes.length,
  };
}

export function maxNullableNumber(
  first: number | null,
  second: number | null | undefined,
): number | null {
  if (first === null || first === undefined) {
    return second ?? null;
  }

  if (second === null || second === undefined) {
    return first;
  }

  return Math.max(first, second);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
