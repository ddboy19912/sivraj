import { createHash } from "node:crypto";
import type {
  DetectedPattern,
  PatternDetector,
  PatternSignal,
} from "../types.js";
import { behaviorPatternSubject } from "../behavior-patterns.js";

export function createRepeatedBehaviorDetector(): PatternDetector {
  return {
    name: "repeated_behavior_detector",
    detect(signals) {
      const grouped = new Map<string, PatternSignal[]>();

      for (const signal of signals) {
        const patternKey = readPatternKey(signal.metadata);

        if (!patternKey) {
          continue;
        }

        grouped.set(patternKey, [
          ...(grouped.get(patternKey) ?? []),
          signal,
        ]);
      }

      return Array.from(grouped.entries())
        .filter(([, group]) => unique(group.map((signal) => signal.candidateMemoryId)).length >= 2)
        .map(([patternKey, group]) => {
          const subject = behaviorPatternSubject(patternKey);
          const evidenceCount = group.length;
          const confidence = Math.min(
            0.95,
            average(group.map((signal) => signal.confidence)) + Math.min(0.2, (evidenceCount - 2) * 0.05),
          );

          return {
            patternType: "repeated_behavior_theme",
            patternHash: patternHash(patternKey),
            subject,
            normalizedSubject: patternKey,
            confidence,
            evidenceCount,
            sourceArtifactIds: unique(group.map((signal) => signal.sourceArtifactId)),
            memoryFragmentIds: unique(group.map((signal) => signal.memoryFragmentId)),
            candidateMemoryIds: unique(group.map((signal) => signal.candidateMemoryId)),
            memoryTypes: unique(group.map((signal) => signal.memoryType)),
            sourceTypes: unique(group.map((signal) => signal.sourceType)),
            detector: "repeated_behavior_detector",
          } satisfies DetectedPattern;
        });
    },
  };
}

function readPatternKey(metadata: unknown): string | null {
  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) {
    return null;
  }

  const value = (metadata as Record<string, unknown>)["patternKey"];
  return typeof value === "string" && value.trim()
    ? value.trim().toLowerCase()
    : null;
}

function patternHash(patternKey: string): string {
  return createHash("sha256")
    .update(`repeated_behavior_theme:${patternKey}`)
    .digest("hex");
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0.5;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}
