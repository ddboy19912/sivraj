import { expect } from "vitest";

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

export async function run_detectpatterns_detects_repeated_goal_subjects_across_current_and_histo() {
  const currentSignals: PatternSignal[] = [
      {
        ...baseSignal,
        candidateMemoryId: "candidate-current",
        evidenceHash: "evidence-current",
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
        evidenceHash: "evidence-old",
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
}

export async function run_detectpatterns_does_not_detect_a_pattern_from_one_isolated_signal() {
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
}

export async function run_detectpatterns_dedupes_same_canonical_memory_before_repeated_subjects() {
  const result = detectPatterns({
      twinId: "twin-id",
      currentSignals: [
        {
          ...baseSignal,
          sourceArtifactId: "artifact-pdf",
          memoryFragmentId: "fragment-pdf",
          candidateMemoryId: "candidate-pdf",
          canonicalMemoryId: "canonical-rg-preference",
          evidenceHash: "pdf-rg-evidence",
          memoryType: "preference",
          subject: "rg",
          sourceType: "pdf",
        },
      ],
      historicalSignals: [
        {
          ...baseSignal,
          sourceArtifactId: "artifact-chat-export",
          memoryFragmentId: "fragment-chat-export",
          candidateMemoryId: "candidate-chat-export",
          canonicalMemoryId: "canonical-rg-preference",
          evidenceHash: "chat-rg-evidence",
          memoryType: "preference",
          subject: "rg",
          sourceType: "chat_export",
        },
      ],
    });

    expect(result.patterns).toEqual([]);
    expect(result.metadata.patternCount).toBe(0);
}

export async function run_detectpatterns_detects_repeated_behavior_themes_across_different_proje() {
  const result = detectPatterns({
      twinId: "twin-id",
      currentSignals: [
        {
          ...baseSignal,
          sourceArtifactId: "artifact-gamma",
          memoryFragmentId: "fragment-gamma",
          candidateMemoryId: "candidate-gamma",
          evidenceHash: "evidence-gamma",
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
          evidenceHash: "evidence-alpha",
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
          evidenceHash: "evidence-beta",
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
}

export async function run_detectpatterns_detects_repeated_engineering_failure_themes() {
  const result = detectPatterns({
      twinId: "twin-id",
      currentSignals: [
        {
          ...baseSignal,
          sourceArtifactId: "artifact-current",
          memoryFragmentId: "fragment-current",
          candidateMemoryId: "candidate-current",
          evidenceHash: "evidence-current",
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
          evidenceHash: "evidence-old",
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
}

export async function run_detectpatterns_keeps_pattern_output_free_of_private_statement_text() {
  const result = detectPatterns({
      twinId: "twin-id",
      currentSignals: [
        {
          ...baseSignal,
          candidateMemoryId: "candidate-current",
          evidenceHash: "evidence-current",
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
          evidenceHash: "evidence-old",
          memoryType: "decision",
          subject: "Sivraj",
        },
      ],
    });

    expect(result.patterns).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain("We decided");
    expect(JSON.stringify(result)).not.toContain("private statement");
}
