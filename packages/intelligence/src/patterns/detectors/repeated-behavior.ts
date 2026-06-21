import { createHash } from "node:crypto";
import type {
  DetectedPattern,
  PatternDetector,
  PatternSignal,
} from "../types.js";
import { behaviorPatternSubject } from "../behavior-patterns.js";
import {
  buildDetectedPatternEvidenceFields,
  dedupePatternEvidenceSignals,
  repeatedEvidenceConfidence,
  repeatedPatternEvidenceCount,
} from "./detector-utils.js";

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
        .filter(([, group]) => repeatedPatternEvidenceCount(group) >= 2)
        .map(([patternKey, group]) => {
          const evidenceGroup = dedupePatternEvidenceSignals(group);
          const subject = behaviorPatternSubject(patternKey);
          const evidenceCount = evidenceGroup.length;
          const confidence = repeatedEvidenceConfidence(evidenceGroup);

          return {
            patternType: "repeated_behavior_theme",
            patternHash: patternHash(patternKey),
            subject,
            normalizedSubject: patternKey,
            confidence,
            evidenceCount,
            ...buildDetectedPatternEvidenceFields(evidenceGroup),
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
