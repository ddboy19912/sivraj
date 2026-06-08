import { describe, expect, it } from "vitest";
import {
  readCanonicalSubject,
  shouldApplySemanticCanonicalMerge,
} from "./canonical-memory-upsert.js";

describe("canonical memory upsert helpers", () => {
  it("reads canonical subjects from metadata", () => {
    expect(readCanonicalSubject({ subject: "  Use pnpm  " })).toBe("Use pnpm");
    expect(readCanonicalSubject({ subject: " " })).toBeNull();
  });

  it("decides when semantic merges should apply", () => {
    expect(shouldApplySemanticCanonicalMerge({
      decision: "same",
      canonicalMemoryId: "memory-1",
      confidence: 0.9,
    })).toBe(true);

    expect(shouldApplySemanticCanonicalMerge({
      decision: "same",
      canonicalMemoryId: "memory-1",
      confidence: 0.5,
    })).toBe(false);
  });
});
