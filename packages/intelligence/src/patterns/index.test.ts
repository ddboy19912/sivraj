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
      detectors: ["repeated_subject_detector", "repeated_behavior_detector"],
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

  it("detects repeated behavior themes across different project subjects", () => {
    const result = detectPatterns({
      twinId: "twin-id",
      currentSignals: [
        {
          ...baseSignal,
          sourceArtifactId: "artifact-gamma",
          memoryFragmentId: "fragment-gamma",
          candidateMemoryId: "candidate-gamma",
          memoryType: "project_update",
          subject: "Project Gamma",
          metadata: {
            patternKey: "launch_delay_ui_polish",
          },
        },
      ],
      historicalSignals: [
        {
          ...baseSignal,
          sourceArtifactId: "artifact-alpha",
          memoryFragmentId: "fragment-alpha",
          candidateMemoryId: "candidate-alpha",
          memoryType: "project_update",
          subject: "Project Alpha",
          metadata: {
            patternKey: "launch_delay_ui_polish",
          },
        },
        {
          ...baseSignal,
          sourceArtifactId: "artifact-beta",
          memoryFragmentId: "fragment-beta",
          candidateMemoryId: "candidate-beta",
          memoryType: "project_update",
          subject: "Project Beta",
          metadata: {
            patternKey: "launch_delay_ui_polish",
          },
        },
      ],
    });

    expect(result.patterns).toHaveLength(1);
    expect(result.patterns[0]).toMatchObject({
      patternType: "repeated_behavior_theme",
      subject: "Launch delay from UI polish",
      normalizedSubject: "launch_delay_ui_polish",
      evidenceCount: 3,
      candidateMemoryIds: ["candidate-alpha", "candidate-beta", "candidate-gamma"],
    });
  });

  it("detects repeated engineering failure themes", () => {
    const result = detectPatterns({
      twinId: "twin-id",
      currentSignals: [
        {
          ...baseSignal,
          sourceArtifactId: "artifact-current",
          memoryFragmentId: "fragment-current",
          candidateMemoryId: "candidate-current",
          memoryType: "project_update",
          subject: "Walrus read",
          metadata: {
            patternKey: "walrus_seal_rpc_fetch_failure",
          },
        },
      ],
      historicalSignals: [
        {
          ...baseSignal,
          sourceArtifactId: "artifact-old",
          memoryFragmentId: "fragment-old",
          candidateMemoryId: "candidate-old",
          memoryType: "project_update",
          subject: "Seal decrypt",
          metadata: {
            patternKey: "walrus_seal_rpc_fetch_failure",
          },
        },
      ],
    });

    expect(result.patterns).toHaveLength(1);
    expect(result.patterns[0]).toMatchObject({
      patternType: "repeated_behavior_theme",
      subject: "Walrus/Seal RPC fetch failure",
      normalizedSubject: "walrus_seal_rpc_fetch_failure",
      evidenceCount: 2,
      candidateMemoryIds: ["candidate-old", "candidate-current"],
    });
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
