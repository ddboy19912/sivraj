import type { MemoryType } from "../../index.js";

type PatternEvidenceSignal = {
  candidateMemoryId: string;
  canonicalMemoryId?: string | null;
  evidenceHash: string;
  confidence: number;
};

export function repeatedEvidenceConfidence(
  group: Array<{ confidence: number }>,
): number {
  const evidenceCount = group.length;

  return Math.min(
    0.95,
    average(group.map((signal) => signal.confidence)) + Math.min(0.2, (evidenceCount - 2) * 0.05),
  );
}

export function buildDetectedPatternEvidenceFields(
  group: Array<{
    sourceArtifactId: string;
    memoryFragmentId: string;
    candidateMemoryId: string;
    canonicalMemoryId?: string | null;
    memoryType: MemoryType;
    sourceType: string;
  }>,
) {
  return {
    sourceArtifactIds: unique(group.map((signal) => signal.sourceArtifactId)),
    memoryFragmentIds: unique(group.map((signal) => signal.memoryFragmentId)),
    candidateMemoryIds: unique(group.map((signal) => signal.candidateMemoryId)),
    canonicalMemoryIds: unique(
      group
        .map((signal) => normalizeString(signal.canonicalMemoryId))
        .filter((value): value is string => Boolean(value)),
    ),
    memoryTypes: unique(group.map((signal) => signal.memoryType)),
    sourceTypes: unique(group.map((signal) => signal.sourceType)),
  };
}

export function dedupePatternEvidenceSignals<T extends PatternEvidenceSignal>(
  signals: T[],
): T[] {
  const deduped = new Map<string, T>();

  for (const signal of signals) {
    const key = patternEvidenceKey(signal);
    const previous = deduped.get(key);

    if (!previous || signal.confidence > previous.confidence) {
      deduped.set(key, signal);
    }
  }

  return Array.from(deduped.values());
}

export function repeatedPatternEvidenceCount(signals: PatternEvidenceSignal[]): number {
  return unique(signals.map(patternEvidenceKey)).length;
}

export function patternEvidenceKey(signal: PatternEvidenceSignal): string {
  const canonicalMemoryId = normalizeString(signal.canonicalMemoryId);
  if (canonicalMemoryId) {
    return `canonical:${canonicalMemoryId}`;
  }

  const evidenceHash = normalizeString(signal.evidenceHash);
  if (evidenceHash) {
    return `evidence:${evidenceHash}`;
  }

  return `candidate:${signal.candidateMemoryId}`;
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0.5;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function normalizeString(value: string | null | undefined): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}
