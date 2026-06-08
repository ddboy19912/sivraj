export function collectArtifactScopedGraphIds(input: {
  artifactId: string;
  artifactNodeIds: string[];
  propertyLinkedNodeIds: string[];
  evidenceEdges: Array<{ id: string; fromNodeId: string; toNodeId: string }>;
  connectedEdges: Array<{ id: string; fromNodeId: string; toNodeId: string }>;
}) {
  const scopedNodeIds = new Set<string>([
    ...input.artifactNodeIds,
    ...input.propertyLinkedNodeIds,
  ]);
  const scopedEdgeIds = new Set<string>();

  for (const edge of input.evidenceEdges) {
    scopedEdgeIds.add(edge.id);
    scopedNodeIds.add(edge.fromNodeId);
    scopedNodeIds.add(edge.toNodeId);
  }

  for (const edge of input.connectedEdges) {
    scopedEdgeIds.add(edge.id);
    scopedNodeIds.add(edge.fromNodeId);
    scopedNodeIds.add(edge.toNodeId);
  }

  return {
    scopedNodeIds,
    scopedEdgeIds,
  };
}

export function artifactScopedGraphNodeName(artifactId: string) {
  return `source_artifact:${artifactId}`;
}
