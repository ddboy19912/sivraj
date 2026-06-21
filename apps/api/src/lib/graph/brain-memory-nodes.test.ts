import { describe, expect, it } from "vitest";
import {
  formatCanonicalCurrentTruthGraphNode,
  formatIdentityProfileGraphNodes,
} from "./brain-memory-nodes.js";

describe("brain memory graph nodes", () => {
  it("formats approved current-truth profile memories as direct brain nodes", () => {
    const [node] = formatCanonicalCurrentTruthGraphNode({
      id: "canonical-1",
      twinId: "twin-1",
      memoryType: "fact",
      canonicalKey: "profile_slot:fortune:name",
      subject: "Fortune",
      status: "approved",
      evidenceCount: 3,
      confidenceScore: 0.92,
      metadata: {
        sourceType: "chat_hot_memory_intake",
        currentTruth: {
          kind: "profile_fact",
          slot: "name",
          value: "Roberto",
          valueType: "string",
          mutable: true,
          status: "active",
          sourceArtifactId: "c38276d3-e054-47b7-bc06-739aea65dc3b",
        },
      },
      firstSeenAt: new Date("2026-06-19T12:00:00.000Z"),
      lastSeenAt: new Date("2026-06-19T12:10:00.000Z"),
      createdAt: new Date("2026-06-19T12:00:00.000Z"),
      updatedAt: new Date("2026-06-19T12:10:00.000Z"),
    } as Parameters<typeof formatCanonicalCurrentTruthGraphNode>[0]);

    expect(node).toMatchObject({
      id: "brain-memory:canonical:canonical-1",
      nodeType: "person",
      name: "Name: Roberto",
      description: expect.stringContaining("Fortune's name is Roberto"),
      properties: {
        kind: "canonical_current_truth",
        canonicalMemoryId: "canonical-1",
        canonicalMemoryIds: ["canonical-1"],
        sourceType: "chat_hot_memory_intake",
        sourceArtifactIds: ["c38276d3-e054-47b7-bc06-739aea65dc3b"],
      },
    });
  });

  it("does not expose inactive current-truth memories", () => {
    expect(formatCanonicalCurrentTruthGraphNode({
      id: "canonical-1",
      twinId: "twin-1",
      memoryType: "fact",
      canonicalKey: "profile_slot:fortune:name",
      subject: "Fortune",
      status: "approved",
      evidenceCount: 3,
      confidenceScore: 0.92,
      metadata: {
        currentTruth: {
          kind: "profile_fact",
          slot: "name",
          value: "Old name",
          status: "inactive",
        },
      },
      firstSeenAt: new Date("2026-06-19T12:00:00.000Z"),
      lastSeenAt: new Date("2026-06-19T12:10:00.000Z"),
      createdAt: new Date("2026-06-19T12:00:00.000Z"),
      updatedAt: new Date("2026-06-19T12:10:00.000Z"),
    } as Parameters<typeof formatCanonicalCurrentTruthGraphNode>[0])).toEqual([]);
  });

  it("formats onboarding identity profile fields as brain nodes", () => {
    const nodes = formatIdentityProfileGraphNodes({
      id: "profile-1",
      twinId: "twin-1",
      displayName: "Fortune",
      aliases: ["Roberto"],
      emails: [],
      phones: [],
      handles: { x: ["@fortune"] },
      selfDescriptionArtifactId: "c88ad49d-2bc8-4100-96ab-e46fa6661fed",
      createdAt: new Date("2026-06-17T12:00:00.000Z"),
      updatedAt: new Date("2026-06-17T12:30:00.000Z"),
    });

    expect(nodes.map((node) => node.name)).toEqual([
      "Name: Fortune",
      "Alias: Roberto",
      "X handle: @fortune",
    ]);
    expect(nodes[0]).toMatchObject({
      id: "brain-memory:identity:profile-1:display_name",
      nodeType: "person",
      description: "The user's name is Fortune. This was saved in the identity profile.",
      properties: {
        kind: "identity_profile",
        profileId: "profile-1",
        sourceType: "identity_profile",
        sourceArtifactId: "c88ad49d-2bc8-4100-96ab-e46fa6661fed",
        sourceArtifactIds: ["c88ad49d-2bc8-4100-96ab-e46fa6661fed"],
      },
    });
  });
});
