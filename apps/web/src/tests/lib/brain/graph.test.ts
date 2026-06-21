import { describe, expect, it } from "vitest";
import {
  buildBrainGraphLayout,
  formatBrainStoredDate,
  resolveBrainNodeCategory,
  resolveBrainNodeDescription,
  resolveBrainNodeSourceArtifactIds,
  resolveBrainNodeSourceType,
  resolveBrainNodeTitle,
  resolveBrainViewState,
  resolveVisibleBrainLayoutNodes,
} from "@/lib/brain/graph";
import type { BrainGraphResponse } from "@/types/brain.types";

describe("brain graph mapping", () => {
  it("handles missing descriptions and old records with only createdAt", () => {
    const node = {
      id: "node-1",
      nodeType: "concept",
      name: "  ",
      description: null,
      properties: null,
      confidenceScore: null,
      createdAt: "2026-04-12T12:00:00.000Z",
    };

    expect(resolveBrainNodeTitle(node, 2)).toBe("Memory 3");
    expect(resolveBrainNodeDescription(node)).toBe(
      "This memory point is stored in the knowledge graph, but no detailed description has been written yet.",
    );
    expect(formatBrainStoredDate(node)).toMatch(/Apr 12, 2026/u);
  });

  it("derives readable titles and descriptions from safe graph metadata", () => {
    const decision = {
      id: "decision-node",
      nodeType: "decision",
      name: "decision:947f582900aa",
      description: null,
      properties: {
        subject: "data privacy",
        sourceType: "chat",
      },
      confidenceScore: null,
      createdAt: "2026-04-12T12:00:00.000Z",
    };
    const pattern = {
      id: "pattern-node",
      nodeType: "other",
      name: "pattern:679512b200cc",
      description: null,
      properties: {
        kind: "pattern",
        patternType: "recurring_goal",
        subject: "Sivraj",
        evidenceCount: 4,
      },
      confidenceScore: null,
      createdAt: "2026-04-12T12:00:00.000Z",
    };

    expect(resolveBrainNodeTitle(decision)).toBe("Decision: data privacy");
    expect(resolveBrainNodeDescription(decision)).toBe(
      "Encrypted decision memory about data privacy. The raw statement stays private while safe metadata keeps it connected.",
    );
    expect(resolveBrainNodeTitle(pattern)).toBe("recurring goal pattern");
    expect(resolveBrainNodeDescription(pattern)).toBe(
      "Detected recurring goal pattern about Sivraj across 4 evidence signals.",
    );
    expect(resolveBrainNodeCategory(decision)).toBe("Decision memory");
    expect(resolveBrainNodeSourceType(decision)).toBe("Chat");
    expect(resolveBrainNodeCategory(pattern)).toBe("Pattern");
    expect(resolveBrainNodeSourceType({
      properties: { sourceTypes: ["pdf", "chat_export", "pdf"] },
    })).toBe("PDF, Chat Memory");
    expect(resolveBrainNodeSourceArtifactIds({
      properties: {
        sourceArtifactId: "artifact-one",
        sourceArtifactIds: ["artifact-two", "artifact-one"],
      },
    })).toEqual(["artifact-one", "artifact-two"]);
  });

  it("uses canonical memory context to clarify legacy topic nodes", () => {
    const layout = buildBrainGraphLayout({
      nodes: [layoutInputTopicNode()],
      edges: [],
    });

    expect(layout.nodes[0]).toMatchObject({
      title: "closures in JavaScript",
      graphTitle: "partial application",
      graphContextLabel: "Topic: partial application",
      description: "Closures in JavaScript can be used for currying and partial application.",
      clusterLabel: "Facts",
      sourceTypeLabel: "Chat Memory",
      sourceArtifactIds: ["artifact-1"],
    });
  });

  it("labels project-cluster records as subject clusters", () => {
    const cluster = {
      nodeType: "project",
      name: "Mr. Brownlow",
      description: null,
      properties: {
        projectCluster: true,
        sourceType: "pdf",
      },
    };

    expect(resolveBrainNodeCategory(cluster)).toBe("Subject cluster");
    expect(resolveBrainNodeSourceType(cluster)).toBe("PDF");
    expect(resolveBrainNodeDescription(cluster)).toBe(
      "Subject cluster inferred from recurring graph signals in PDF memory.",
    );
  });

  it("labels profile and current-truth brain nodes clearly", () => {
    const layout = buildBrainGraphLayout({
      nodes: [
        {
          id: "profile-node",
          nodeType: "person",
          name: "Name: Fortune",
          description: "The user's name is Fortune. This was saved in the identity profile.",
          properties: {
            kind: "identity_profile",
            profileLabel: "Name",
            sourceType: "identity_profile",
            sourceArtifactIds: ["c88ad49d-2bc8-4100-96ab-e46fa6661fed"],
          },
          confidenceScore: null,
          createdAt: "2026-06-17T12:00:00.000Z",
          updatedAt: "2026-06-17T12:30:00.000Z",
        },
        {
          id: "truth-node",
          nodeType: "person",
          name: "Name: Roberto",
          description: "Current profile fact: Fortune's name is Roberto.",
          properties: {
            kind: "canonical_current_truth",
            currentTruthKind: "profile_fact",
            sourceType: "chat_hot_memory_intake",
            canonicalMemoryId: "canonical-1",
          },
          canonicalMemories: [
            {
              id: "canonical-1",
              candidateMemoryId: null,
              memoryType: "fact",
              subject: "Fortune",
              summary: "Current profile fact: Fortune's name is Roberto.",
              canonicalKey: "profile_slot:fortune:name",
              status: "approved",
              sourceType: "chat_hot_memory_intake",
              sourceArtifactIds: [],
              memoryFragmentIds: [],
              evidenceCount: 3,
              confidenceScore: 0.9,
              createdAt: "2026-06-19T12:00:00.000Z",
              updatedAt: "2026-06-19T12:10:00.000Z",
            },
          ],
          confidenceScore: null,
          createdAt: "2026-06-19T12:00:00.000Z",
          updatedAt: "2026-06-19T12:10:00.000Z",
        },
      ],
      edges: [],
    });

    expect(layout.nodes.find((node) => node.id === "profile-node")).toMatchObject({
      title: "Name: Fortune",
      description: "The user's name is Fortune. This was saved in the identity profile.",
      categoryLabel: "Identity profile",
      sourceTypeLabel: "Identity Profile",
      sourceArtifactIds: ["c88ad49d-2bc8-4100-96ab-e46fa6661fed"],
      clusterLabel: "Facts",
    });
    expect(resolveVisibleBrainLayoutNodes(layout.nodes, {
      clusterId: null,
      searchQuery: "c88ad49d-2bc8-4100-96ab-e46fa6661fed",
    }).map((node) => node.id)).toEqual(["profile-node"]);
    expect(layout.nodes.find((node) => node.id === "truth-node")).toMatchObject({
      title: "Name: Roberto",
      categoryLabel: "Profile fact",
      sourceTypeLabel: "Chat Memory",
      clusterLabel: "Facts",
    });
  });

  it("falls back to connected edge descriptions when node metadata is sparse", () => {
    expect(resolveBrainNodeDescription({
      nodeType: "concept",
      name: "Sparse node",
      description: null,
      properties: null,
    }, ["Source artifact contains an encrypted candidate memory classified as a goal."]))
      .toBe("Connected context: Source artifact contains an encrypted candidate memory classified as a goal.");
  });

  it("prefers updatedAt when formatting the stored date", () => {
    expect(
      formatBrainStoredDate({
        createdAt: "2026-04-12T12:00:00.000Z",
        updatedAt: "2026-05-20T12:00:00.000Z",
      }),
    ).toMatch(/May 20, 2026/u);
  });

  it("returns a deterministic 2d constellation layout with category links", () => {
    const graph = createGraph();
    const first = buildBrainGraphLayout(graph);
    const second = buildBrainGraphLayout({
      nodes: [...graph.nodes].reverse(),
      edges: graph.edges,
    });

    expect(first.nodes).toEqual(second.nodes);
    expect(first.links).toEqual(second.links);
    expect(first.nodes.find((node) => node.id === "node-a")?.position)
      .toEqual(expect.objectContaining({
        x: expect.any(Number),
        y: expect.any(Number),
      }));
    expect(first.nodes.find((node) => node.id === "node-a")?.position.x)
      .toBeGreaterThanOrEqual(6);
    expect(first.nodes.find((node) => node.id === "node-a")?.position.x)
      .toBeLessThanOrEqual(94);
    expect(first.links).toEqual([
      expect.objectContaining({
        clusterId: "topics",
        fromNodeId: expect.stringMatching(/^node-[ac]$/u),
        toNodeId: expect.stringMatching(/^node-[ac]$/u),
      }),
    ]);
    expect(first.nodes.find((node) => node.id === "node-a")?.sourceArtifactIds)
      .toEqual(["artifact-from-source-node"]);
    expect(first.groups.map((group) => ({
      label: group.label,
      count: group.count,
    }))).toEqual([
      { label: "Topics", count: 2 },
      { label: "Sources", count: 1 },
    ]);
  });

  it("filters visible layout nodes by category and search query", () => {
    const layout = buildBrainGraphLayout(createGraph());

    expect(resolveVisibleBrainLayoutNodes(layout.nodes, {
      clusterId: null,
      searchQuery: "",
    })).toHaveLength(3);
    expect(resolveVisibleBrainLayoutNodes(layout.nodes, {
      clusterId: "topics",
      searchQuery: "",
    }).map((node) => node.id).toSorted()).toEqual(["node-a", "node-c"]);
    expect(resolveVisibleBrainLayoutNodes(layout.nodes, {
      clusterId: "topics",
      searchQuery: "dense",
    }).map((node) => node.id)).toEqual(["node-c"]);
    expect(resolveVisibleBrainLayoutNodes(layout.nodes, {
      clusterId: "sources",
      searchQuery: "dense",
    })).toHaveLength(0);
  });

  it("resolves loading, empty, ready, and error states", () => {
    expect(resolveBrainViewState({
      graph: null,
      isLoading: true,
      error: null,
    })).toEqual({ status: "loading" });
    expect(resolveBrainViewState({
      graph: { ...createGraph(), nodes: [], edges: [] },
      isLoading: false,
      error: null,
    }).status).toBe("empty");
    expect(resolveBrainViewState({
      graph: createGraph(),
      isLoading: false,
      error: null,
    }).status).toBe("ready");
    expect(resolveBrainViewState({
      graph: null,
      isLoading: false,
      error: new Error("No graph"),
    })).toEqual({ status: "error", message: "No graph" });
  });
});

function createGraph(): BrainGraphResponse {
  return {
    policy: {
      rawArtifactsIncluded: false,
      scope: "memory:read",
    },
    nodes: [
      {
        id: "node-b",
        nodeType: "artifact",
        name: "source_artifact:artifact-from-source-node",
        description: "Memory-first workspace source.",
        properties: {
          sourceArtifactId: "artifact-from-source-node",
        },
        confidenceScore: null,
        createdAt: "2026-01-02T00:00:00.000Z",
        updatedAt: "2026-01-03T00:00:00.000Z",
      },
      {
        id: "node-a",
        nodeType: "concept",
        name: "User taste",
        description: "Prefers direct product surfaces.",
        properties: null,
        confidenceScore: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-04T00:00:00.000Z",
      },
      {
        id: "node-c",
        nodeType: "concept",
        name: "Product surfaces",
        description: "Keeps app surfaces dense and task focused.",
        properties: null,
        confidenceScore: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-04T00:00:00.000Z",
      },
    ],
    edges: [
      {
        id: "edge-1",
        fromNodeId: "node-a",
        toNodeId: "node-b",
        edgeType: "related",
        description: null,
        confidenceScore: null,
        createdAt: "2026-01-05T00:00:00.000Z",
      },
      {
        id: "edge-missing",
        fromNodeId: "node-a",
        toNodeId: "node-missing",
        edgeType: "related",
        description: null,
        confidenceScore: null,
        createdAt: "2026-01-05T00:00:00.000Z",
      },
    ],
  };
}

function layoutInputTopicNode(): BrainGraphResponse["nodes"][number] {
  return {
    id: "topic-node",
    nodeType: "topic",
    name: "partial application",
    description: "topic detected from Chat Export memory and connected to related memory evidence.",
    properties: {
      entityType: "topic",
      sourceType: "chat_export",
    },
    canonicalMemories: [
      {
        id: "canonical-1",
        candidateMemoryId: "candidate-1",
        memoryType: "fact",
        subject: "closures in JavaScript",
        summary: "Closures in JavaScript can be used for currying and partial application.",
        canonicalKey: "subject:fact:closures_in_javascript:general",
        status: "candidate",
        sourceType: "chat_export",
        sourceArtifactIds: ["artifact-1"],
        memoryFragmentIds: ["fragment-1"],
        evidenceCount: 14,
        confidenceScore: 0.9,
        createdAt: "2026-06-19T21:34:26.000Z",
        updatedAt: "2026-06-19T21:35:22.000Z",
      },
    ],
    confidenceScore: null,
    createdAt: "2026-06-19T21:34:26.000Z",
    updatedAt: "2026-06-19T21:35:22.000Z",
  };
}
