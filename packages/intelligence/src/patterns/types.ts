import type { MemoryType } from "../index.js";

export type PatternSignal = {
  twinId: string;
  sourceArtifactId: string;
  memoryFragmentId: string;
  candidateMemoryId: string;
  memoryType: MemoryType;
  subject: string | null;
  confidence: number;
  evidenceHash: string;
  evidenceLength: number | null;
  sourceType: string;
  createdAt?: string | null;
  metadata?: Record<string, unknown>;
};

export type PatternType =
  | "repeated_goal_subject"
  | "repeated_decision_subject"
  | "repeated_preference_subject"
  | "repeated_project_activity";

export type DetectedPattern = {
  patternType: PatternType;
  patternHash: string;
  subject: string;
  normalizedSubject: string;
  confidence: number;
  evidenceCount: number;
  sourceArtifactIds: string[];
  memoryFragmentIds: string[];
  candidateMemoryIds: string[];
  memoryTypes: MemoryType[];
  sourceTypes: string[];
  detector: string;
};

export type PatternDetectionInput = {
  twinId: string;
  currentSignals: PatternSignal[];
  historicalSignals: PatternSignal[];
};

export type PatternDetectionResult = {
  patterns: DetectedPattern[];
  metadata: {
    detectorVersion: 1;
    signalCount: number;
    currentSignalCount: number;
    historicalSignalCount: number;
    patternCount: number;
    detectors: string[];
  };
};

export type PatternDetector = {
  name: string;
  detect(signals: PatternSignal[]): DetectedPattern[];
};
