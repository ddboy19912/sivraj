import type { MemoryType } from "../../index.js";

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
    memoryType: MemoryType;
    sourceType: string;
  }>,
) {
  return {
    sourceArtifactIds: unique(group.map((signal) => signal.sourceArtifactId)),
    memoryFragmentIds: unique(group.map((signal) => signal.memoryFragmentId)),
    candidateMemoryIds: unique(group.map((signal) => signal.candidateMemoryId)),
    memoryTypes: unique(group.map((signal) => signal.memoryType)),
    sourceTypes: unique(group.map((signal) => signal.sourceType)),
  };
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
