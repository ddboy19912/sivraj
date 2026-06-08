import { describe, expect, it } from "vitest";
import {
  artifactScopedGraphNodeName,
  collectArtifactScopedGraphIds,
} from "./scoped-loader.js";

describe("graph scoped loader helpers", () => {
  it("builds artifact scoped node names", () => {
    expect(artifactScopedGraphNodeName("artifact-1")).toBe("source_artifact:artifact-1");
  });

  it("collects scoped node and edge ids", () => {
    const scoped = collectArtifactScopedGraphIds({
      artifactId: "artifact-1",
      artifactNodeIds: ["node-1"],
      propertyLinkedNodeIds: ["node-2"],
      evidenceEdges: [{ id: "edge-1", fromNodeId: "node-3", toNodeId: "node-4" }],
      connectedEdges: [{ id: "edge-2", fromNodeId: "node-1", toNodeId: "node-5" }],
    });

    expect(Array.from(scoped.scopedNodeIds).sort()).toEqual([
      "node-1",
      "node-2",
      "node-3",
      "node-4",
      "node-5",
    ]);
    expect(Array.from(scoped.scopedEdgeIds).sort()).toEqual(["edge-1", "edge-2"]);
  });
});
