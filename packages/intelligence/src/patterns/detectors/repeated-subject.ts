import { createHash } from "node:crypto";
import type {
  DetectedPattern,
  PatternDetector,
  PatternSignal,
  PatternType,
} from "../types.js";
import type { MemoryType } from "../../index.js";
import { buildDetectedPatternEvidenceFields, repeatedEvidenceConfidence, unique } from "./detector-utils.js";

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
      const firstSubject = group.find((signal) => signal.subject)?.subject ?? normalizedSubject;
      const evidenceCount = group.length;
      const confidence = repeatedEvidenceConfidence(group);

      return {
        patternType,
        patternHash: patternHash(patternType, normalizedSubject, group),
        subject: firstSubject,
        normalizedSubject,
        confidence,
        evidenceCount,
        ...buildDetectedPatternEvidenceFields(group),
        detector: "repeated_subject_detector",
      };
    });
}

function hasRepeatedEvidence(signals: PatternSignal[]): boolean {
  if (signals.length < 2) {
    return false;
  }

  return unique(signals.map((signal) => signal.candidateMemoryId)).length >= 2;
}

function patternHash(
  patternType: PatternType,
  normalizedSubject: string,
  signals: PatternSignal[],
): string {
  const evidence = unique(signals.map((signal) => signal.candidateMemoryId)).sort().join("|");

  return createHash("sha256")
    .update(`${patternType}:${normalizedSubject}:${evidence}`)
    .digest("hex");
}

function normalizeSubject(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}
