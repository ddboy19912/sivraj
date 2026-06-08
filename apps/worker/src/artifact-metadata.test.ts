import { describe, expect, it } from "vitest";
import {
  artifactMetadata,
  readArtifactProcessingMetadata,
  readIntelligenceStatus,
  readProcessingReason,
} from "./artifact-metadata.js";

describe("artifactMetadata", () => {
  it("returns objects and rejects non-objects", () => {
    expect(artifactMetadata({ status: "pending" })).toEqual({ status: "pending" });
    expect(artifactMetadata(null)).toEqual({});
    expect(artifactMetadata(["x"])).toEqual({});
  });
});

describe("readArtifactProcessingMetadata", () => {
  it("reads nested processing metadata", () => {
    expect(readArtifactProcessingMetadata({
      processing: { reason: "retry", intelligence: { status: "queued" } },
    })).toEqual({ reason: "retry", intelligence: { status: "queued" } });
    expect(readArtifactProcessingMetadata({ processing: "bad" })).toBeUndefined();
    expect(readArtifactProcessingMetadata(null)).toBeUndefined();
  });
});

describe("readProcessingReason", () => {
  it("returns string reasons only", () => {
    expect(readProcessingReason({ processing: { reason: "timeout" } })).toBe("timeout");
    expect(readProcessingReason({ processing: { reason: 1 } })).toBeUndefined();
  });
});

describe("readIntelligenceStatus", () => {
  it("returns known intelligence statuses", () => {
    expect(readIntelligenceStatus({ processing: { intelligence: { status: "completed" } } }))
      .toBe("completed");
    expect(readIntelligenceStatus({ processing: { intelligence: { status: "bogus" } } }))
      .toBeUndefined();
    expect(readIntelligenceStatus({ processing: { intelligence: null } })).toBeUndefined();
  });
});
