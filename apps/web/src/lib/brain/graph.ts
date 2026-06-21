import type {
  BrainCanonicalMemoryContext,
  BrainGraphEdge,
  BrainGraphNode,
  BrainGraphResponse,
} from "@/types/brain.types";

const BRAIN_DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
});

const BRAIN_CLUSTER_REGIONS: Record<BrainClusterKey, {
  label: string;
  color: string;
  anchor: BrainPoint;
}> = {
  facts: {
    label: "Facts",
    color: "#6ee7f9",
    anchor: { x: 16, y: 23 },
  },
  preferences: {
    label: "Preferences",
    color: "#a7f3d0",
    anchor: { x: 39, y: 20 },
  },
  goals: {
    label: "Goals",
    color: "#f8d36b",
    anchor: { x: 62, y: 22 },
  },
  decisions: {
    label: "Decisions",
    color: "#fb9f89",
    anchor: { x: 84, y: 31 },
  },
  projects: {
    label: "Projects",
    color: "#c4b5fd",
    anchor: { x: 24, y: 52 },
  },
  relationships: {
    label: "Relationships",
    color: "#f0abfc",
    anchor: { x: 10, y: 63 },
  },
  experiences: {
    label: "Experiences",
    color: "#93c5fd",
    anchor: { x: 44, y: 48 },
  },
  patterns: {
    label: "Patterns",
    color: "#5eead4",
    anchor: { x: 65, y: 55 },
  },
  entities: {
    label: "Entities",
    color: "#fde68a",
    anchor: { x: 83, y: 66 },
  },
  topics: {
    label: "Topics",
    color: "#86efac",
    anchor: { x: 56, y: 79 },
  },
  sources: {
    label: "Sources",
    color: "#67e8f9",
    anchor: { x: 35, y: 80 },
  },
  other: {
    label: "Other",
    color: "#d4d4d8",
    anchor: { x: 12, y: 84 },
  },
};

const BRAIN_LAYOUT_BOUNDS = {
  minX: 6,
  maxX: 94,
  minY: 8,
  maxY: 91,
};

const BRAIN_CLUSTER_ORDER: BrainClusterKey[] = [
  "facts",
  "preferences",
  "goals",
  "decisions",
  "projects",
  "relationships",
  "experiences",
  "patterns",
  "entities",
  "topics",
  "sources",
  "other",
];

export type BrainClusterKey =
  | "facts"
  | "preferences"
  | "goals"
  | "decisions"
  | "projects"
  | "relationships"
  | "experiences"
  | "patterns"
  | "entities"
  | "topics"
  | "sources"
  | "other";

export type BrainPoint = {
  x: number;
  y: number;
};

export type BrainLayoutNode = {
  id: string;
  title: string;
  graphTitle: string;
  graphContextLabel: string | null;
  description: string;
  categoryLabel: string;
  clusterId: BrainClusterKey;
  clusterLabel: string;
  clusterColor: string;
  sourceTypeLabel: string;
  sourceArtifactIds: string[];
  canonicalMemories: BrainCanonicalMemoryContext[];
  storedAtLabel: string;
  position: BrainPoint;
  radius: number;
};

export type BrainLayoutLink = {
  id: string;
  clusterId: BrainClusterKey;
  color: string;
  fromNodeId: string;
  toNodeId: string;
};

export type BrainLayoutGroup = {
  id: BrainClusterKey;
  label: string;
  count: number;
  color: string;
  anchor: BrainPoint;
  centroid: BrainPoint;
  radius: number;
};

export type BrainGraphLayout = {
  groups: BrainLayoutGroup[];
  links: BrainLayoutLink[];
  nodes: BrainLayoutNode[];
};

export type BrainGraphFilter = {
  clusterId: BrainClusterKey | null;
  searchQuery: string;
};

export function buildBrainGraphLayout(
  graph: Pick<BrainGraphResponse, "nodes" | "edges">,
): BrainGraphLayout {
  const orderedNodes = graph.nodes.toSorted(compareGraphNodesForLayout);
  const edgeDescriptionsByNodeId = collectConnectedEdgeDescriptions(graph.edges);
  const sourceArtifactIdsByNodeId = collectSourceArtifactIdsByNodeId(graph.nodes, graph.edges);
  const nodeDrafts = orderedNodes.map((node, index) => {
    const graphTitle = resolveBrainNodeTitle(node, index);
    const canonicalMemories = resolveBrainNodeCanonicalMemories(node);
    const categoryLabel = resolveBrainNodeCategory(node);
    const clusterKey = resolveBrainNodeClusterKey(node, canonicalMemories);
    const cluster = BRAIN_CLUSTER_REGIONS[clusterKey];

    return {
      clusterKey,
      id: node.id,
      title: resolveBrainNodeDisplayTitle(node, graphTitle, canonicalMemories),
      graphTitle,
      graphContextLabel: resolveBrainNodeGraphContextLabel(
        node,
        graphTitle,
        categoryLabel,
        canonicalMemories,
      ),
      description: resolveBrainNodeDescription(
        node,
        edgeDescriptionsByNodeId.get(node.id) ?? [],
        canonicalMemories,
      ),
      categoryLabel,
      clusterId: clusterKey,
      clusterLabel: cluster.label,
      clusterColor: cluster.color,
      sourceTypeLabel: resolveBrainNodeSourceType(node),
      sourceArtifactIds: uniqueStrings([
        ...(sourceArtifactIdsByNodeId.get(node.id) ?? []),
        ...canonicalMemories.flatMap((memory) => memory.sourceArtifactIds),
      ]),
      canonicalMemories,
      storedAtLabel: formatBrainStoredDate(node),
      radius: roundCoordinate(7.2 + normalizedHash(`${node.id}:radius`) * 5.2),
    };
  });
  const groupCounts = countBrainClusters(nodeDrafts);
  const groupIndexCounters = new Map<BrainClusterKey, number>();
  const nodeEntries = nodeDrafts.map((draft): BrainLayoutNode => {
    const { clusterKey, ...node } = draft;
    const localIndex = groupIndexCounters.get(clusterKey) ?? 0;
    groupIndexCounters.set(clusterKey, localIndex + 1);
    const position = positionBrainNodeInCluster({
      clusterKey,
      nodeId: node.id,
      nodeName: node.title,
      localIndex,
      count: groupCounts.get(clusterKey) ?? 1,
    });

    return {
      ...node,
      position,
    };
  });

  return {
    groups: collectBrainLayoutGroups(groupCounts, nodeEntries),
    links: resolveBrainLayoutLinks(nodeEntries),
    nodes: nodeEntries,
  };
}

export function resolveBrainLayoutLinks(nodes: BrainLayoutNode[]): BrainLayoutLink[] {
  return BRAIN_CLUSTER_ORDER.flatMap((clusterId) => {
    const clusterNodes = nodes.filter((node) => node.clusterId === clusterId);
    if (clusterNodes.length < 2) {
      return [];
    }

    return connectClusterNodes(clusterId, clusterNodes);
  });
}

export function resolveVisibleBrainLayoutNodes(
  nodes: BrainLayoutNode[],
  filter: BrainGraphFilter,
): BrainLayoutNode[] {
  const searchQuery = filter.searchQuery.trim().toLowerCase();

  return nodes.filter((node) => {
    if (filter.clusterId && node.clusterId !== filter.clusterId) {
      return false;
    }

    return searchQuery.length === 0 || matchesBrainNodeSearch(node, searchQuery);
  });
}

function matchesBrainNodeSearch(node: BrainLayoutNode, query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery.length === 0) {
    return true;
  }

  return [
    node.title,
    node.graphTitle,
    node.graphContextLabel ?? "",
    node.description,
    node.categoryLabel,
    node.clusterLabel,
    node.sourceTypeLabel,
    node.storedAtLabel,
    ...node.sourceArtifactIds,
    ...node.canonicalMemories.flatMap((memory) => [
      memory.subject ?? "",
      memory.summary,
      memory.memoryType,
      memory.sourceType ?? "",
      ...memory.sourceArtifactIds,
      ...memory.memoryFragmentIds,
    ]),
  ].some((value) => value.toLowerCase().includes(normalizedQuery));
}

export function resolveBrainViewState(input: {
  graph: BrainGraphResponse | null;
  isLoading: boolean;
  error: unknown;
}): import("@/types/brain.types").BrainViewState {
  if (input.error) {
    return { status: "error", message: errorMessage(input.error) };
  }

  if (input.graph) {
    return input.graph.nodes.length > 0
      ? { status: "ready", graph: input.graph }
      : { status: "empty", graph: input.graph };
  }

  return input.isLoading ? { status: "loading" } : { status: "idle" };
}

export function resolveBrainNodeTitle(
  node: Pick<BrainGraphNode, "name" | "nodeType" | "properties">,
  index = 0,
): string {
  const title = node.name.trim();
  if (title.length > 0 && !isTechnicalGraphName(title)) {
    return title;
  }

  const properties = asRecord(node.properties);
  const subject = readStringProperty(properties, "subject");
  const patternType = formatPropertyLabel(readStringProperty(properties, "patternType"));
  const sourceType = readStringProperty(properties, "sourceType");
  const sourceTypeLabel = sourceType ? formatSourceType(sourceType) : null;

  if (node.nodeType === "decision" && subject) {
    return `Decision: ${subject}`;
  }

  if (node.nodeType === "goal" && subject) {
    return `Goal: ${subject}`;
  }

  if (readStringProperty(properties, "kind") === "pattern") {
    return patternType ? `${patternType} pattern` : "Detected pattern";
  }

  if (node.nodeType === "artifact" || title.startsWith("source_artifact:")) {
    return sourceTypeLabel ? `${sourceTypeLabel} source` : "Source artifact";
  }

  return title.length > 0
    ? formatPropertyLabel(node.nodeType) ?? `Memory ${index + 1}`
    : `Memory ${index + 1}`;
}

export function resolveBrainNodeDescription(
  node: Pick<BrainGraphNode, "description" | "name" | "nodeType" | "properties">,
  connectedDescriptions: string[] = [],
  canonicalMemories: BrainCanonicalMemoryContext[] = [],
): string {
  const canonicalSummary = canonicalMemories.find((memory) => memory.summary.trim().length > 0)?.summary;
  if (shouldLeadWithCanonicalMemory(node, canonicalMemories) && canonicalSummary) {
    return canonicalSummary;
  }

  const description = node.description?.trim();
  if (description && description.length > 0) {
    return description;
  }

  const propertyDescription = describeNodeFromProperties(node);
  if (propertyDescription) {
    return propertyDescription;
  }

  const connectedDescription = connectedDescriptions.find((value) => value.trim().length > 0);
  if (connectedDescription) {
    return `Connected context: ${connectedDescription}`;
  }

  return "This memory point is stored in the knowledge graph, but no detailed description has been written yet.";
}

function resolveBrainNodeCanonicalMemories(
  node: Pick<BrainGraphNode, "canonicalMemories">,
): BrainCanonicalMemoryContext[] {
  return Array.isArray(node.canonicalMemories)
    ? node.canonicalMemories.filter((memory) => (
        typeof memory.id === "string" &&
        memory.id.trim().length > 0 &&
        typeof memory.summary === "string" &&
        memory.summary.trim().length > 0
      ))
    : [];
}

export function resolveBrainNodeCategory(
  node: Pick<BrainGraphNode, "nodeType" | "properties">,
): string {
  const properties = asRecord(node.properties);
  const kind = readStringProperty(properties, "kind");

  if (kind === "canonical_current_truth") {
    return formatCurrentTruthCategory(properties);
  }

  if (kind === "identity_profile") {
    return "Identity profile";
  }

  if (readBooleanProperty(properties, "projectCluster")) {
    return "Subject cluster";
  }

  if (kind === "pattern") {
    return "Pattern";
  }

  if (node.nodeType === "decision") {
    return "Decision memory";
  }

  if (node.nodeType === "goal") {
    return "Goal memory";
  }

  if (node.nodeType === "artifact") {
    return "Source artifact";
  }

  if (["person", "organization", "project", "concept", "event", "topic"].includes(node.nodeType)) {
    return formatGraphType(node.nodeType);
  }

  return "Knowledge node";
}

export function resolveBrainNodeSourceType(
  node: Pick<BrainGraphNode, "properties">,
): string {
  const properties = asRecord(node.properties);
  const sourceType = readStringProperty(properties, "sourceType");
  if (sourceType) {
    return formatSourceType(sourceType);
  }

  const sourceTypes = readStringArrayProperty(properties, "sourceTypes");
  if (sourceTypes.length > 0) {
    return [...new Set(sourceTypes.map(formatSourceType))].join(", ");
  }

  return "Unknown source";
}

export function resolveBrainNodeSourceArtifactIds(
  node: Pick<BrainGraphNode, "properties">,
): string[] {
  const properties = asRecord(node.properties);
  const sourceArtifactId = readStringProperty(properties, "sourceArtifactId");
  const sourceArtifactIds = readStringArrayProperty(properties, "sourceArtifactIds");

  return [...new Set([
    ...(sourceArtifactId ? [sourceArtifactId] : []),
    ...sourceArtifactIds,
  ])];
}

export function formatBrainStoredDate(
  node: Pick<BrainGraphNode, "createdAt" | "updatedAt">,
): string {
  const candidate = node.updatedAt ?? node.createdAt;
  const date = new Date(candidate);

  if (Number.isNaN(date.getTime())) {
    return "Date unavailable";
  }

  return BRAIN_DATE_FORMATTER.format(date);
}

function resolveBrainNodeClusterKey(
  node: Pick<BrainGraphNode, "nodeType" | "name" | "properties">,
  canonicalMemories: BrainCanonicalMemoryContext[] = [],
): BrainClusterKey {
  const primaryMemoryType = canonicalMemories[0]?.memoryType;
  if (primaryMemoryType) {
    return clusterKeyForMemoryType(primaryMemoryType);
  }

  const properties = asRecord(node.properties);
  const kind = readStringProperty(properties, "kind");

  if (kind === "identity_profile") {
    return "facts";
  }

  if (kind === "pattern") {
    return "patterns";
  }

  if (node.nodeType === "artifact" || node.name.startsWith("source_artifact:")) {
    return "sources";
  }

  if (node.nodeType === "goal") {
    return "goals";
  }

  if (node.nodeType === "decision") {
    return "decisions";
  }

  if (readBooleanProperty(properties, "projectCluster") || node.nodeType === "project") {
    return "projects";
  }

  if (node.nodeType === "person" || node.nodeType === "organization") {
    return "entities";
  }

  if (node.nodeType === "topic" || node.nodeType === "concept" || node.nodeType === "event") {
    return "topics";
  }

  return "other";
}

function clusterKeyForMemoryType(memoryType: string): BrainClusterKey {
  switch (memoryType) {
    case "preference":
      return "preferences";
    case "goal":
      return "goals";
    case "decision":
      return "decisions";
    case "commitment":
      return "decisions";
    case "experience":
      return "experiences";
    case "project_update":
      return "projects";
    case "relationship":
      return "relationships";
    case "fact":
      return "facts";
    default:
      return "other";
  }
}

function countBrainClusters(nodes: Array<{ clusterKey: BrainClusterKey }>) {
  const counts = new Map<BrainClusterKey, number>();

  for (const node of nodes) {
    counts.set(node.clusterKey, (counts.get(node.clusterKey) ?? 0) + 1);
  }

  return counts;
}

function collectBrainLayoutGroups(
  groupCounts: Map<BrainClusterKey, number>,
  nodes: BrainLayoutNode[],
): BrainLayoutGroup[] {
  const positionsByCluster = new Map<BrainClusterKey, BrainPoint[]>();
  for (const node of nodes) {
    positionsByCluster.set(node.clusterId, [
      ...(positionsByCluster.get(node.clusterId) ?? []),
      node.position,
    ]);
  }

  return BRAIN_CLUSTER_ORDER.flatMap((clusterKey) => {
    const count = groupCounts.get(clusterKey) ?? 0;
    if (count === 0) {
      return [];
    }

    const cluster = BRAIN_CLUSTER_REGIONS[clusterKey];
    const positions = positionsByCluster.get(clusterKey) ?? [];
    const centroid = averagePoints(positions, cluster.anchor);
    return [{
      id: clusterKey,
      label: cluster.label,
      count,
      color: cluster.color,
      anchor: cluster.anchor,
      centroid,
      radius: clusterSpread(positions, centroid),
    }];
  });
}

function averagePoints(points: BrainPoint[], fallback: BrainPoint): BrainPoint {
  if (points.length === 0) {
    return roundPoint(fallback);
  }

  const sum = points.reduce(addPoints, { x: 0, y: 0 });
  return roundPoint(scalePoint(sum, 1 / points.length));
}

function clusterSpread(points: BrainPoint[], centroid: BrainPoint): number {
  if (points.length < 2) {
    return 8;
  }

  const maxDistance = points.reduce((max, point) => (
    Math.max(max, Math.sqrt(squaredPointDistance(point, centroid)))
  ), 0);

  return roundCoordinate(Math.max(8, maxDistance));
}

function positionBrainNodeInCluster(input: {
  clusterKey: BrainClusterKey;
  nodeId: string;
  nodeName: string;
  localIndex: number;
  count: number;
}) {
  const cluster = BRAIN_CLUSTER_REGIONS[input.clusterKey];
  const seed = normalizedHash(`${input.clusterKey}:${input.nodeId}:${input.nodeName}`);
  const angle = input.localIndex * 2.399963229728653 + seed * Math.PI * 1.35;
  const radiusFactor = input.count === 1
    ? 0.12 + seed * 0.12
    : Math.sqrt((input.localIndex + 0.5) / input.count);
  const spread = clusterSpreadForCount(input.count);
  const radialJitter = 0.82 + normalizedHash(`${input.nodeId}:cluster-r`) * 0.34;
  const xJitter = (normalizedHash(`${input.nodeId}:x-jitter`) - 0.5) * 1.7;
  const yJitter = (normalizedHash(`${input.nodeId}:y-jitter`) - 0.5) * 1.4;
  const position = {
    x: cluster.anchor.x + Math.cos(angle) * spread.x * radiusFactor * radialJitter + xJitter,
    y: cluster.anchor.y + Math.sin(angle) * spread.y * radiusFactor * radialJitter + yJitter,
  };

  return roundPoint(clampPointToBounds(position));
}

function clusterSpreadForCount(count: number) {
  const density = Math.sqrt(Math.max(1, count));
  return {
    x: clampNumber(4.5 + density * 2.1, 7, 18.5),
    y: clampNumber(4 + density * 1.85, 6.5, 16.5),
  };
}

function connectClusterNodes(
  clusterId: BrainClusterKey,
  nodes: BrainLayoutNode[],
): BrainLayoutLink[] {
  const cluster = BRAIN_CLUSTER_REGIONS[clusterId];
  const unvisited = new Set(nodes.map((node) => node.id));
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const startNode = nodes.toSorted((a, b) => (
    squaredPointDistance(a.position, cluster.anchor) - squaredPointDistance(b.position, cluster.anchor)
      || a.id.localeCompare(b.id)
  ))[0];
  if (!startNode) {
    return [];
  }

  const visited = new Set([startNode.id]);
  unvisited.delete(startNode.id);
  const links: BrainLayoutLink[] = [];

  while (unvisited.size > 0) {
    let nextLink: { from: BrainLayoutNode; to: BrainLayoutNode; distance: number } | null = null;

    for (const fromId of visited) {
      const from = nodesById.get(fromId);
      if (!from) {
        continue;
      }

      for (const toId of unvisited) {
        const to = nodesById.get(toId);
        if (!to) {
          continue;
        }

        const distance = squaredPointDistance(from.position, to.position);
        if (
          !nextLink ||
          distance < nextLink.distance ||
          (distance === nextLink.distance && `${from.id}:${to.id}` < `${nextLink.from.id}:${nextLink.to.id}`)
        ) {
          nextLink = { from, to, distance };
        }
      }
    }

    if (!nextLink) {
      break;
    }

    const fromNodeId = nextLink.from.id;
    const toNodeId = nextLink.to.id;
    visited.add(toNodeId);
    unvisited.delete(toNodeId);
    links.push({
      id: `${clusterId}:${fromNodeId}:${toNodeId}`,
      clusterId,
      color: cluster.color,
      fromNodeId,
      toNodeId,
    });
  }

  return links;
}

function collectConnectedEdgeDescriptions(edges: BrainGraphEdge[]) {
  const descriptionsByNodeId = new Map<string, string[]>();

  for (const edge of edges) {
    const description = edge.description?.trim() || describeEdgeType(edge.edgeType);
    addConnectedEdgeDescription(descriptionsByNodeId, edge.fromNodeId, description);
    addConnectedEdgeDescription(descriptionsByNodeId, edge.toNodeId, description);
  }

  return descriptionsByNodeId;
}

function collectSourceArtifactIdsByNodeId(
  nodes: BrainGraphNode[],
  edges: BrainGraphEdge[],
) {
  const directArtifactIdsByNodeId = new Map<string, string[]>();
  const artifactNodeIds = new Set<string>();

  for (const node of nodes) {
    const sourceArtifactIds = resolveBrainNodeSourceArtifactIds(node);
    if (sourceArtifactIds.length > 0) {
      directArtifactIdsByNodeId.set(node.id, sourceArtifactIds);
    }

    if (node.nodeType === "artifact" || node.name.startsWith("source_artifact:")) {
      artifactNodeIds.add(node.id);
    }
  }

  const sourceArtifactIdsByNodeId = new Map(directArtifactIdsByNodeId);

  for (const edge of edges) {
    if (artifactNodeIds.has(edge.fromNodeId)) {
      addSourceArtifactIds(
        sourceArtifactIdsByNodeId,
        edge.toNodeId,
        directArtifactIdsByNodeId.get(edge.fromNodeId) ?? [],
      );
    }

    if (artifactNodeIds.has(edge.toNodeId)) {
      addSourceArtifactIds(
        sourceArtifactIdsByNodeId,
        edge.fromNodeId,
        directArtifactIdsByNodeId.get(edge.toNodeId) ?? [],
      );
    }
  }

  return sourceArtifactIdsByNodeId;
}

function addSourceArtifactIds(
  sourceArtifactIdsByNodeId: Map<string, string[]>,
  nodeId: string,
  sourceArtifactIds: string[],
) {
  if (sourceArtifactIds.length === 0) {
    return;
  }

  sourceArtifactIdsByNodeId.set(nodeId, [
    ...new Set([
      ...(sourceArtifactIdsByNodeId.get(nodeId) ?? []),
      ...sourceArtifactIds,
    ]),
  ]);
}

function addConnectedEdgeDescription(
  descriptionsByNodeId: Map<string, string[]>,
  nodeId: string,
  description: string,
) {
  const descriptions = descriptionsByNodeId.get(nodeId) ?? [];
  if (!descriptions.includes(description)) {
    descriptionsByNodeId.set(nodeId, [...descriptions, description].slice(0, 3));
  }
}

function describeNodeFromProperties(
  node: Pick<BrainGraphNode, "name" | "nodeType" | "properties">,
) {
  const properties = asRecord(node.properties);
  const sourceType = readStringProperty(properties, "sourceType");
  const sourceTypeLabel = sourceType ? formatSourceType(sourceType) : null;
  const subject = readStringProperty(properties, "subject")
    ?? readStringProperty(properties, "normalizedSubject");
  const aboutSubject = subject ? ` about ${subject}` : "";
  const sourceContext = sourceTypeLabel ? ` from ${sourceTypeLabel} memory` : "";
  const evidenceCount = readNumberProperty(properties, "evidenceCount");
  const kind = readStringProperty(properties, "kind");

  if (kind === "identity_profile") {
    const label = readStringProperty(properties, "profileLabel") ?? "Profile field";
    return `${label} saved in the user's identity profile.`;
  }

  if (node.nodeType === "artifact" || node.name.startsWith("source_artifact:")) {
    return `Source artifact${sourceContext} that contributed evidence to the knowledge graph.`;
  }

  if (kind === "pattern") {
    const patternType = formatPropertyLabel(readStringProperty(properties, "patternType"));
    const evidenceText = evidenceCount ? ` across ${evidenceCount} evidence signals` : "";
    return `Detected ${patternType || "behavior"} pattern${aboutSubject}${evidenceText}.`;
  }

  if (node.nodeType === "decision") {
    return `Encrypted decision memory${aboutSubject}. The raw statement stays private while safe metadata keeps it connected.`;
  }

  if (node.nodeType === "goal") {
    return `Encrypted goal memory${aboutSubject}. The raw statement stays private while safe metadata keeps it connected.`;
  }

  if (readBooleanProperty(properties, "projectCluster")) {
    return sourceTypeLabel
      ? `Subject cluster inferred from recurring graph signals in ${sourceTypeLabel} memory.`
      : "Subject cluster inferred from recurring graph signals.";
  }

  const entityType = formatPropertyLabel(readStringProperty(properties, "entityType"));
  if (entityType) {
    return `${entityType} detected${sourceContext} and connected to related memory evidence.`;
  }

  return null;
}

function describeEdgeType(edgeType: string) {
  const label = formatPropertyLabel(edgeType);
  return label ? `Connected through ${label} evidence.` : "Connected through graph evidence.";
}

function compareGraphNodesForLayout(a: BrainGraphNode, b: BrainGraphNode) {
  const idCompare = a.id.localeCompare(b.id);
  return idCompare === 0 ? a.name.localeCompare(b.name) : idCompare;
}

function squaredPointDistance(a: BrainPoint, b: BrainPoint) {
  const deltaX = a.x - b.x;
  const deltaY = a.y - b.y;

  return deltaX * deltaX + deltaY * deltaY;
}

function addPoints(a: BrainPoint, b: BrainPoint): BrainPoint {
  return {
    x: a.x + b.x,
    y: a.y + b.y,
  };
}

function scalePoint(point: BrainPoint, scale: number): BrainPoint {
  return {
    x: point.x * scale,
    y: point.y * scale,
  };
}

function clampPointToBounds(point: BrainPoint): BrainPoint {
  return {
    x: clampNumber(point.x, BRAIN_LAYOUT_BOUNDS.minX, BRAIN_LAYOUT_BOUNDS.maxX),
    y: clampNumber(point.y, BRAIN_LAYOUT_BOUNDS.minY, BRAIN_LAYOUT_BOUNDS.maxY),
  };
}

function roundPoint(point: BrainPoint): BrainPoint {
  return {
    x: roundCoordinate(point.x),
    y: roundCoordinate(point.y),
  };
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalizedHash(value: string) {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0) / 4294967295;
}

function roundCoordinate(value: number) {
  return Math.round(value * 1000) / 1000;
}

function isTechnicalGraphName(value: string) {
  return /^(source_artifact|decision|goal|pattern):[a-f0-9-]+$/iu.test(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readStringProperty(
  record: Record<string, unknown>,
  key: string,
): string | null {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function readNumberProperty(
  record: Record<string, unknown>,
  key: string,
): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readBooleanProperty(
  record: Record<string, unknown>,
  key: string,
): boolean {
  return record[key] === true;
}

function readStringArrayProperty(
  record: Record<string, unknown>,
  key: string,
): string[] {
  const value = record[key];
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => (
    typeof item === "string" && item.trim().length > 0
  )).map((item) => item.trim());
}

function formatSourceType(value: string) {
  const normalized = value.trim().toLowerCase();
  if (
    normalized === "chat_export" ||
    normalized === "chat_hot_memory_intake" ||
    normalized === "chat_hot_engineering_memory_intake"
  ) {
    return "Chat Memory";
  }

  if (normalized === "identity_profile") {
    return "Identity Profile";
  }

  if (normalized === "onboarding_self_description") {
    return "Onboarding";
  }

  if (normalized === "pdf" || normalized === "docx" || normalized === "ocr_pdf") {
    return normalized.toUpperCase().replace("_", " ");
  }

  return toDisplayTitleCase(formatPropertyLabel(value) ?? value);
}

function formatGraphType(value: string) {
  const label = formatPropertyLabel(value);
  return label ? toDisplayTitleCase(label) : "Knowledge node";
}

function formatPropertyLabel(value: string | null) {
  if (!value) {
    return null;
  }

  return value
    .replace(/[_-]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function toDisplayTitleCase(value: string) {
  return value.replace(/\S+/gu, (word) => (
    word.length <= 2
      ? word.toUpperCase()
      : `${word.slice(0, 1).toUpperCase()}${word.slice(1).toLowerCase()}`
  ));
}

function formatCurrentTruthCategory(properties: Record<string, unknown>) {
  const currentTruthKind = readStringProperty(properties, "currentTruthKind");
  if (currentTruthKind === "engineering_memory") {
    return "Engineering memory";
  }

  if (currentTruthKind === "preference") {
    return "Preference memory";
  }

  if (currentTruthKind === "note") {
    return "Note";
  }

  return "Profile fact";
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0)));
}

function resolveBrainNodeDisplayTitle(
  node: Pick<BrainGraphNode, "nodeType" | "name" | "properties">,
  graphTitle: string,
  canonicalMemories: BrainCanonicalMemoryContext[],
) {
  if (!shouldLeadWithCanonicalMemory(node, canonicalMemories)) {
    return graphTitle;
  }

  const primaryMemory = canonicalMemories[0];
  return primaryMemory?.subject?.trim() || graphTitle;
}

function resolveBrainNodeGraphContextLabel(
  node: Pick<BrainGraphNode, "nodeType" | "name" | "properties">,
  graphTitle: string,
  categoryLabel: string,
  canonicalMemories: BrainCanonicalMemoryContext[],
) {
  if (!shouldLeadWithCanonicalMemory(node, canonicalMemories)) {
    return null;
  }

  return `${categoryLabel}: ${graphTitle}`;
}

function shouldLeadWithCanonicalMemory(
  node: Pick<BrainGraphNode, "nodeType" | "name" | "properties">,
  canonicalMemories: BrainCanonicalMemoryContext[],
) {
  return canonicalMemories.length > 0 && (
    node.nodeType === "topic" ||
    node.nodeType === "concept" ||
    readStringProperty(asRecord(node.properties), "entityType") === "topic"
  );
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unable to load brain graph.";
}
