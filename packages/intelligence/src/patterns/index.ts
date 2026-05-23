import { createRepeatedSubjectDetector } from "./detectors/repeated-subject.js";
import type {
  DetectedPattern,
  PatternDetectionInput,
  PatternDetectionResult,
  PatternDetector,
  PatternSignal,
} from "./types.js";

export type {
  DetectedPattern,
  PatternDetectionInput,
  PatternDetectionResult,
  PatternDetector,
  PatternSignal,
  PatternType,
} from "./types.js";

export function detectPatterns(input: PatternDetectionInput, options: {
  detectors?: PatternDetector[];
} = {}): PatternDetectionResult {
  const detectors = options.detectors ?? [
    createRepeatedSubjectDetector(),
  ];
  const signals = dedupeSignals([
    ...input.historicalSignals,
    ...input.currentSignals,
  ]);
  const currentSignalIds = new Set(input.currentSignals.map((signal) => signal.candidateMemoryId));
  const patterns = dedupePatterns(
    detectors
      .flatMap((detector) => detector.detect(signals))
      .filter((pattern) => pattern.candidateMemoryIds.some((id) => currentSignalIds.has(id))),
  );

  return {
    patterns,
    metadata: {
      detectorVersion: 1,
      signalCount: signals.length,
      currentSignalCount: input.currentSignals.length,
      historicalSignalCount: input.historicalSignals.length,
      patternCount: patterns.length,
      detectors: detectors.map((detector) => detector.name),
    },
  };
}

function dedupeSignals(signals: PatternSignal[]): PatternSignal[] {
  const deduped = new Map<string, PatternSignal>();

  for (const signal of signals) {
    deduped.set(signal.candidateMemoryId, signal);
  }

  return Array.from(deduped.values());
}

function dedupePatterns(patterns: DetectedPattern[]): DetectedPattern[] {
  const deduped = new Map<string, DetectedPattern>();

  for (const pattern of patterns) {
    deduped.set(`${pattern.patternType}:${pattern.patternHash}`, pattern);
  }

  return Array.from(deduped.values())
    .sort((left, right) => right.confidence - left.confidence);
}
