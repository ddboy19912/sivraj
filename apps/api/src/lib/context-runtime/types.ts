export const CONTEXT_RUNTIME_SURFACES = [
  "web_chat",
  "voice_chat",
  "onboarding_voice",
  "mcp",
  "cli",
  "external_api",
  "mobile",
  "desktop",
] as const;

export const CONTEXT_RUNTIME_MODES = [
  "answer_context",
  "voice_turn",
  "agent_context",
  "memory_search",
  "document_qa",
] as const;

export const CONTEXT_RUNTIME_RETRIEVAL_DEPTHS = ["hot", "warm", "cold"] as const;

export type ContextRuntimeSurface = typeof CONTEXT_RUNTIME_SURFACES[number];
export type ContextRuntimeMode = typeof CONTEXT_RUNTIME_MODES[number];
export type ContextRuntimeRetrievalDepth = typeof CONTEXT_RUNTIME_RETRIEVAL_DEPTHS[number];

export type ContextRuntimeStatus =
  | "ready"
  | "partial"
  | "warming"
  | "cold_required"
  | "degraded";

export type ContextRuntimePacketKind =
  | "core_profile"
  | "personal_hot_memory"
  | "engineering_context"
  | "document_inventory"
  | "active_session"
  | "surface_warmup";

export type ContextRuntimeSourceRef = {
  type: "canonical_memory" | "context_runtime_packet" | "source_artifact" | "memory_fragment" | "candidate_memory";
  id: string;
  label?: string | null;
};

export type ContextRuntimeItem = {
  id: string;
  kind: "core_profile" | "current_fact" | "engineering_memory" | "context_packet";
  label: string;
  content: string;
  status: "approved" | "candidate" | "derived";
  confidenceScore?: number | null;
  sourceRefs: ContextRuntimeSourceRef[];
};

export type ContextRuntimeResult = {
  packetId: string | null;
  status: ContextRuntimeStatus;
  contextItems: ContextRuntimeItem[];
  citations: ContextRuntimeSourceRef[];
  sourceRefs: ContextRuntimeSourceRef[];
  policy: {
    surface: ContextRuntimeSurface;
    mode: ContextRuntimeMode;
    retrievalDepth: ContextRuntimeRetrievalDepth;
    rawArtifactsIncluded: false;
    decryptedMemoryIncluded: boolean;
    plaintextStatementsIncluded: false;
    coldRetrievalAllowed: boolean;
  };
  timings: Record<string, number>;
  cache: {
    packetHitCount: number;
    canonicalHitCount: number;
    ciphertextCacheHitCount: number;
    walrusReadCount: number;
    sealDecryptCount: number;
  };
  warnings: string[];
};
