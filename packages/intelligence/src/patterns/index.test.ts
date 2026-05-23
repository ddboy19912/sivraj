import { describe, expect, it } from "vitest";
import { detectPatterns, type PatternSignal } from "./index.js";

const baseSignal = {
  twinId: "twin-id",
  sourceArtifactId: "artifact-id",
  memoryFragmentId: "fragment-id",
  confidence: 0.8,
  evidenceHash: "evidence-hash",
  evidenceLength: 42,
  sourceType: "note",
};

describe("detectPatterns", () => {
  it("detects repeated goal subjects across current and historical signals", () => {
    const currentSignals: PatternSignal[] = [
      {
        ...baseSignal,
        candidateMemoryId: "candidate-current",
        memoryType: "goal",
        subject: "Sivraj",
      },
    ];
    const historicalSignals: PatternSignal[] = [
      {
        ...baseSignal,
        sourceArtifactId: "artifact-old",
        memoryFragmentId: "fragment-old",
        candidateMemoryId: "candidate-old",
        memoryType: "goal",
        subject: "sivraj",
      },
    ];

    const result = detectPatterns({
      twinId: "twin-id",
      currentSignals,
      historicalSignals,
    });

    expect(result.patterns).toHaveLength(1);
    expect(result.patterns[0]).toMatchObject({
      patternType: "repeated_goal_subject",
      subject: "sivraj",
      normalizedSubject: "sivraj",
      evidenceCount: 2,
      candidateMemoryIds: ["candidate-old", "candidate-current"],
    });
    expect(result.patterns[0]?.patternHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.metadata).toMatchObject({
      detectorVersion: 1,
      currentSignalCount: 1,
      historicalSignalCount: 1,
      patternCount: 1,
      detectors: ["repeated_subject_detector"],
    });
  });

  it("does not detect a pattern from one isolated signal", () => {
    const result = detectPatterns({
      twinId: "twin-id",
      currentSignals: [
        {
          ...baseSignal,
          candidateMemoryId: "candidate-current",
          memoryType: "decision",
          subject: "Sivraj",
        },
      ],
      historicalSignals: [],
    });

    expect(result.patterns).toEqual([]);
    expect(result.metadata.patternCount).toBe(0);
  });

  it("keeps pattern output free of private statement text", () => {
    const result = detectPatterns({
      twinId: "twin-id",
      currentSignals: [
        {
          ...baseSignal,
          candidateMemoryId: "candidate-current",
          memoryType: "decision",
          subject: "Sivraj",
          metadata: {
            normalizedStatementHash: "hash-only",
          },
        },
      ],
      historicalSignals: [
        {
          ...baseSignal,
          candidateMemoryId: "candidate-old",
          memoryType: "decision",
          subject: "Sivraj",
        },
      ],
    });

    expect(result.patterns).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain("We decided");
    expect(JSON.stringify(result)).not.toContain("private statement");
  });
});
