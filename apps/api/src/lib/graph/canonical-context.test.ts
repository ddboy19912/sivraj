import { describe, expect, it } from "vitest";
import {
  collectGraphNodeContextKeys,
  formatGraphCanonicalMemoryContext,
  scoreCandidateMemoryForGraphNode,
} from "./canonical-context.js";

describe("graph canonical context helpers", () => {
  it("collects direct memory ids and edge evidence fragments for graph nodes", () => {
    const keys = collectGraphNodeContextKeys([
      {
        id: "topic-node",
        nodeType: "topic",
        name: "partial application",
        normalizedName: "partial application",
        properties: {
          sourceArtifactId: "artifact-1",
          candidateMemoryIds: ["candidate-1"],
        },
      },
      {
        id: "artifact-node",
        nodeType: "artifact",
        name: "source_artifact:artifact-1",
        normalizedName: "source_artifact:artifact-1",
        properties: null,
      },
    ], [
      {
        fromNodeId: "artifact-node",
        toNodeId: "topic-node",
        evidenceMemoryIds: ["fragment-1"],
      },
    ]);

    expect(keys.get("topic-node")).toEqual({
      candidateMemoryIds: ["candidate-1"],
      canonicalMemoryIds: [],
      memoryFragmentIds: ["fragment-1"],
      sourceArtifactIds: ["artifact-1"],
    });
  });

  it("scores legacy topic nodes against canonical memory context lines", () => {
    const score = scoreCandidateMemoryForGraphNode({
      node: {
        id: "topic-node",
        nodeType: "topic",
        name: "partial application",
        normalizedName: "partial application",
        properties: null,
      },
      candidate: {
        memoryType: "fact",
        metadata: {
          subject: "JavaScript Closures",
          agentContextLine: "Closures in JavaScript can be used for currying and partial application.",
        },
      },
      canonical: {
        memoryType: "fact",
        canonicalKey: "subject:fact:closures_in_javascript:general",
        subject: "closures in JavaScript",
        metadata: {},
      },
    });

    expect(score).toBeGreaterThanOrEqual(6);
  });

  it("formats safe canonical memory context without raw artifact content", () => {
    const context = formatGraphCanonicalMemoryContext({
      candidate: {
        id: "candidate-1",
        sourceArtifactId: "artifact-1",
        memoryFragmentId: "fragment-1",
        metadata: {
          sourceType: "chat_export",
          agentContextLine: "Closures in JavaScript can be used for currying and partial application.",
        },
      },
      canonical: {
        id: "canonical-1",
        memoryType: "fact",
        canonicalKey: "subject:fact:closures_in_javascript:general",
        subject: "closures in JavaScript",
        status: "candidate",
        evidenceCount: 14,
        confidenceScore: 0.9,
        metadata: {
          sourceArtifactIds: ["artifact-1"],
          memoryFragmentIds: ["fragment-1"],
        },
        createdAt: new Date("2026-06-19T21:34:26.000Z"),
        updatedAt: new Date("2026-06-19T21:35:22.000Z"),
      },
    } as Parameters<typeof formatGraphCanonicalMemoryContext>[0]);

    expect(context).toMatchObject({
      id: "canonical-1",
      candidateMemoryId: "candidate-1",
      subject: "closures in JavaScript",
      summary: "Closures in JavaScript can be used for currying and partial application.",
      sourceType: "chat_export",
      sourceArtifactIds: ["artifact-1"],
      memoryFragmentIds: ["fragment-1"],
    });
  });
});
