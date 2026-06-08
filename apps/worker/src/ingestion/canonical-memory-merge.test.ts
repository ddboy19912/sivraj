import { describe, expect, it } from "vitest";
import {
  clampConfidence,
  parseCanonicalMemoryMergeResponse,
  readMergeDecision,
} from "./canonical-memory-merge.js";

describe("canonical memory merge helpers", () => {
  it("normalizes merge decisions", () => {
    expect(readMergeDecision("same")).toBe("same");
    expect(readMergeDecision("unknown")).toBe("separate");
  });

  it("clamps confidence values", () => {
    expect(clampConfidence(1.5)).toBe(1);
    expect(clampConfidence("bad")).toBe(0);
  });

  it("parses valid same-memory merge responses", () => {
    expect(parseCanonicalMemoryMergeResponse({
      decision: "same",
      canonicalMemoryId: "memory-1",
      confidence: 0.92,
      reason: "Same preference",
    }, [{ id: "memory-1" }])).toEqual({
      decision: "same",
      canonicalMemoryId: "memory-1",
      confidence: 0.92,
      reason: "Same preference",
    });
  });

  it("rejects unknown canonical ids for same decisions", () => {
    expect(parseCanonicalMemoryMergeResponse({
      decision: "same",
      canonicalMemoryId: "missing",
      confidence: 0.9,
    }, [{ id: "memory-1" }])).toEqual({
      decision: "separate",
      canonicalMemoryId: null,
      confidence: 0,
      reason: "Merge judge returned an unknown canonical memory id.",
    });
  });
});
