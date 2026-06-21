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

export type BrainSourceKindFilter = "all" | "agent_instructions";

export type BrainSourceArtifactSummary = {
  artifactId: string;
  sourceType: string;
  sourceKind: string;
  displayName: string;
  targetInstructionFile: string | null;
  agentInstructionFileName: string | null;
  ingestionStatus: string;
  intelligenceStatus: string | null;
  processing: Record<string, unknown> | null;
  exactContentAvailable: boolean;
  candidateMemoryCount: number;
  engineeringMemoryCount: number;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type BrainSourcesResponse = {
  policy: {
    rawArtifactsIncluded: false;
    exactContentEndpoint: boolean;
    scope: "memory:read";
  };
  kind: BrainSourceKindFilter;
  sources: BrainSourceArtifactSummary[];
  summary: {
    sourceCount: number;
    agentInstructionSourceCount: number;
    exactContentAvailableCount: number;
  };
};

export type BrainArtifactContentResponse = {
  policy: {
    rawArtifactsIncluded: true;
    decryptedSourceIncluded: true;
    scope: "memory:read";
  };
  artifact: {
    id: string;
    sourceType: string;
    ingestionStatus: string;
    fileName: string;
    title: string | null;
    contentType: string;
    encoding: "text" | "data_url";
    byteLength: number;
    metadata: Record<string, unknown>;
    createdAt: string;
    updatedAt: string;
  };
  content: string;
};
