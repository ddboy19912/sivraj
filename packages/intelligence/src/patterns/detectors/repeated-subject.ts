import { createHash } from "node:crypto";
import type {
  DetectedPattern,
  PatternDetector,
  PatternSignal,
  PatternType,
} from "../types.js";
import type { MemoryType } from "../../index.js";
import {
  buildDetectedPatternEvidenceFields,
  dedupePatternEvidenceSignals,
  patternEvidenceKey,
  repeatedEvidenceConfidence,
  repeatedPatternEvidenceCount,
} from "./detector-utils.js";

const REPEATED_SUBJECT_MEMORY_TYPES: Array<{
  memoryType: MemoryType;
  patternType: PatternType;
}> = [
  { memoryType: "goal", patternType: "repeated_goal_subject" },
  { memoryType: "decision", patternType: "repeated_decision_subject" },
  { memoryType: "preference", patternType: "repeated_preference_subject" },
  { memoryType: "project_update", patternType: "repeated_project_activity" },
];

export function createRepeatedSubjectDetector(): PatternDetector {
  return {
    name: "repeated_subject_detector",
    detect(signals) {
      return REPEATED_SUBJECT_MEMORY_TYPES.flatMap(({ memoryType, patternType }) =>
        detectRepeatedSubject(signals, memoryType, patternType),
      );
    },
  };
}

function detectRepeatedSubject(
  signals: PatternSignal[],
  memoryType: MemoryType,
  patternType: PatternType,
): DetectedPattern[] {
  const grouped = new Map<string, PatternSignal[]>();

  for (const signal of signals) {
    if (signal.memoryType !== memoryType || !signal.subject) {
      continue;
    }

    const normalizedSubject = normalizeSubject(signal.subject);

    if (normalizedSubject.length < 2) {
      continue;
    }

    grouped.set(normalizedSubject, [
      ...(grouped.get(normalizedSubject) ?? []),
      signal,
    ]);
  }

  return Array.from(grouped.entries())
    .filter(([, group]) => hasRepeatedEvidence(group))
    .map(([normalizedSubject, group]) => {
      const evidenceGroup = dedupePatternEvidenceSignals(group);
      const firstSubject = evidenceGroup.find((signal) => signal.subject)?.subject ?? normalizedSubject;
      const evidenceCount = evidenceGroup.length;
      const confidence = repeatedEvidenceConfidence(evidenceGroup);

      return {
        patternType,
        patternHash: patternHash(patternType, normalizedSubject, evidenceGroup),
        subject: firstSubject,
        normalizedSubject,
        confidence,
        evidenceCount,
        ...buildDetectedPatternEvidenceFields(evidenceGroup),
        detector: "repeated_subject_detector",
      };
    });
}

function hasRepeatedEvidence(signals: PatternSignal[]): boolean {
  return repeatedPatternEvidenceCount(signals) >= 2;
}

function patternHash(
  patternType: PatternType,
  normalizedSubject: string,
  signals: PatternSignal[],
): string {
  const evidence = signals.map(patternEvidenceKey).sort().join("|");

  return createHash("sha256")
    .update(`${patternType}:${normalizedSubject}:${evidence}`)
    .digest("hex");
}

function normalizeSubject(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}
