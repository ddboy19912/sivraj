export type BrainCanonicalMemoryContext = {
  id: string;
  candidateMemoryId: string | null;
  memoryType: string;
  subject: string | null;
  summary: string;
  canonicalKey: string;
  status: string;
  sourceType: string | null;
  sourceArtifactIds: string[];
  memoryFragmentIds: string[];
  evidenceCount: number;
  confidenceScore: string | number | null;
  createdAt: string;
  updatedAt?: string | null;
};

export type BrainGraphNode = {
  id: string;
  nodeType: string;
  name: string;
  description: string | null;
  properties?: unknown;
  canonicalMemories?: BrainCanonicalMemoryContext[];
  confidenceScore: string | number | null;
  createdAt: string;
  updatedAt?: string | null;
};

export type BrainGraphEdge = {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  edgeType: string;
  description: string | null;
  confidenceScore: string | number | null;
  createdAt: string;
  updatedAt?: string | null;
};

export type BrainGraphResponse = {
  policy: {
    rawArtifactsIncluded: boolean;
    canonicalMemoryContextIncluded?: boolean;
    scope: "memory:read";
  };
  nodes: BrainGraphNode[];
  edges: BrainGraphEdge[];
};

export type BrainViewState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; graph: BrainGraphResponse }
  | { status: "empty"; graph: BrainGraphResponse }
  | { status: "error"; message: string };
