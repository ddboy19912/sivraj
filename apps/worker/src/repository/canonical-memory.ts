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
  const currentTruth = readCurrentTruth(metadata);
  if (subject && currentTruth?.slot) {
    return [
      "profile_slot",
      normalizeCanonicalText(subject),
      normalizeCanonicalText(currentTruth.slot),
    ].join(":");
  }

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
  const currentTruth = mergeCurrentTruthMetadata(existing, incoming, evidence);
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
    ...(currentTruth ? { currentTruth } : {}),
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

type CurrentTruthMetadata = {
  kind: string;
  slot: string;
  value: string;
  valueType: string;
  mutable: boolean;
  status: "active";
  evidenceHash: string;
  sourceArtifactId: string;
  memoryFragmentId: string;
  updatedAt: string;
  previousValues: Array<{
    value: string;
    evidenceHash?: string;
    sourceArtifactId?: string;
    memoryFragmentId?: string;
    validUntil: string;
  }>;
  conflictResolution?: {
    action: "superseded_previous_value" | "merged_same_value";
    previousValue?: string;
    newValue: string;
    resolvedAt: string;
  };
};

function mergeCurrentTruthMetadata(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
  evidence: {
    sourceArtifactId: string;
    memoryFragmentId: string;
    evidenceHash: string;
  },
): CurrentTruthMetadata | null {
  const incomingTruth = readCurrentTruth(incoming);
  if (!incomingTruth) {
    return readCurrentTruth(existing);
  }

  const existingTruth = readCurrentTruth(existing);
  const now = new Date().toISOString();
  const base: CurrentTruthMetadata = {
    ...incomingTruth,
    status: "active",
    evidenceHash: evidence.evidenceHash,
    sourceArtifactId: evidence.sourceArtifactId,
    memoryFragmentId: evidence.memoryFragmentId,
    updatedAt: now,
    previousValues: existingTruth?.previousValues ?? [],
  };

  if (!existingTruth || !sameCurrentTruthSlot(existingTruth, incomingTruth)) {
    return base;
  }

  if (normalizeCurrentTruthValue(existingTruth.value) === normalizeCurrentTruthValue(incomingTruth.value)) {
    return {
      ...base,
      previousValues: existingTruth.previousValues,
      conflictResolution: {
        action: "merged_same_value",
        newValue: incomingTruth.value,
        resolvedAt: now,
      },
    };
  }

  if (!incomingTruth.mutable) {
    return {
      ...base,
      previousValues: existingTruth.previousValues,
      conflictResolution: {
        action: "superseded_previous_value",
        previousValue: existingTruth.value,
        newValue: incomingTruth.value,
        resolvedAt: now,
      },
    };
  }

  return {
    ...base,
    previousValues: [
      ...existingTruth.previousValues,
      {
        value: existingTruth.value,
        evidenceHash: existingTruth.evidenceHash,
        sourceArtifactId: existingTruth.sourceArtifactId,
        memoryFragmentId: existingTruth.memoryFragmentId,
        validUntil: now,
      },
    ],
    conflictResolution: {
      action: "superseded_previous_value",
      previousValue: existingTruth.value,
      newValue: incomingTruth.value,
      resolvedAt: now,
    },
  };
}

function readCurrentTruth(metadata: Record<string, unknown>): CurrentTruthMetadata | null {
  const raw = asRecord(metadata.currentTruth);
  const nestedRaw = asRecord(asRecord(metadata.memoryMetadata).currentTruth);
  const source = Object.keys(raw).length > 0 ? raw : nestedRaw;
  const slot = readNonEmptyString(source.slot);
  const value = readNonEmptyString(source.value);
  if (!slot || !value) {
    return null;
  }

  return {
    kind: readNonEmptyString(source.kind) ?? "profile_fact",
    slot,
    value,
    valueType: readNonEmptyString(source.valueType) ?? "string",
    mutable: source.mutable !== false,
    status: "active",
    evidenceHash: readNonEmptyString(source.evidenceHash) ?? "",
    sourceArtifactId: readNonEmptyString(source.sourceArtifactId) ?? "",
    memoryFragmentId: readNonEmptyString(source.memoryFragmentId) ?? "",
    updatedAt: readNonEmptyString(source.updatedAt) ?? new Date(0).toISOString(),
    previousValues: readPreviousCurrentTruthValues(source.previousValues),
    ...(asRecord(source.conflictResolution).action
      ? { conflictResolution: asRecord(source.conflictResolution) as CurrentTruthMetadata["conflictResolution"] }
      : {}),
  };
}

function readPreviousCurrentTruthValues(value: unknown): CurrentTruthMetadata["previousValues"] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    const record = asRecord(entry);
    const previousValue = readNonEmptyString(record.value);
    const validUntil = readNonEmptyString(record.validUntil);
    if (!previousValue || !validUntil) {
      return [];
    }

    return [{
      value: previousValue,
      evidenceHash: readNonEmptyString(record.evidenceHash) ?? undefined,
      sourceArtifactId: readNonEmptyString(record.sourceArtifactId) ?? undefined,
      memoryFragmentId: readNonEmptyString(record.memoryFragmentId) ?? undefined,
      validUntil,
    }];
  });
}

function sameCurrentTruthSlot(left: CurrentTruthMetadata, right: CurrentTruthMetadata) {
  return normalizeCanonicalText(left.slot) === normalizeCanonicalText(right.slot);
}

function normalizeCurrentTruthValue(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
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
