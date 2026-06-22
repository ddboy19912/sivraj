import type { ApiDb } from "../../app.js";
import {
  contextItemsFromRuntimePackets,
  loadReadyContextRuntimePackets,
  refreshContextRuntimePackets,
} from "./packets.js";
import type {
  ContextRuntimeItem,
  ContextRuntimeMode,
  ContextRuntimeResult,
  ContextRuntimeRetrievalDepth,
  ContextRuntimeSourceRef,
  ContextRuntimeSurface,
} from "./types.js";

export async function resolveTwinContext(input: {
  db: ApiDb;
  twinId: string;
  userId: string;
  requester: {
    type: string;
    id: string;
    scopes: string[];
  };
  surface: ContextRuntimeSurface;
  query: string;
  mode: ContextRuntimeMode;
  scopes: string[];
  latencyBudgetMs: number;
  retrievalDepth?: ContextRuntimeRetrievalDepth;
  includeEvidence?: boolean;
  projectFingerprint?: Record<string, unknown> | null;
}): Promise<ContextRuntimeResult> {
  const timings: Record<string, number> = {};
  const totalStartedAt = Date.now();
  const retrievalDepth = input.retrievalDepth ?? defaultRetrievalDepth(input.surface, input.mode);
  const packetLoadStartedAt = Date.now();
  let packetRows = await loadReadyContextRuntimePackets({
    db: input.db,
    twinId: input.twinId,
    kinds: ["core_profile", "personal_hot_memory", "engineering_context", "document_inventory", "active_session", "surface_warmup"],
  });
  timings.packetLoadMs = Date.now() - packetLoadStartedAt;

  if (packetRows.length === 0) {
    const refreshStartedAt = Date.now();
    await refreshContextRuntimePackets({
      db: input.db,
      twinId: input.twinId,
      surface: input.surface,
      reason: "resolve_miss",
    });
    timings.packetRefreshMs = Date.now() - refreshStartedAt;
    const reloadStartedAt = Date.now();
    packetRows = await loadReadyContextRuntimePackets({
      db: input.db,
      twinId: input.twinId,
      kinds: ["core_profile", "personal_hot_memory", "engineering_context", "document_inventory", "active_session", "surface_warmup"],
    });
    timings.packetReloadMs = Date.now() - reloadStartedAt;
  }

  const packetItems = contextItemsFromRuntimePackets(packetRows);
  const scopedItems = filterItemsForSurface(packetItems, input.surface, input.mode);
  const sourceRefs = collectSourceRefs(scopedItems);
  const wantsColdEvidence = retrievalDepth === "cold" && input.includeEvidence === true;
  const status = resolveRuntimeStatus({
    items: scopedItems,
    retrievalDepth,
    wantsColdEvidence,
    latencyBudgetMs: input.latencyBudgetMs,
    elapsedMs: Date.now() - totalStartedAt,
  });
  const warnings = [
    ...(wantsColdEvidence ? ["cold_evidence_retrieval_not_in_runtime_fast_path"] : []),
    ...(status === "partial" ? ["hot_context_empty_or_incomplete"] : []),
  ];

  timings.totalMs = Date.now() - totalStartedAt;

  return {
    packetId: packetRows[0]?.id ?? null,
    status,
    contextItems: scopedItems,
    citations: sourceRefs,
    sourceRefs,
    policy: {
      surface: input.surface,
      mode: input.mode,
      retrievalDepth,
      rawArtifactsIncluded: false,
      decryptedMemoryIncluded: false,
      plaintextStatementsIncluded: false,
      coldRetrievalAllowed: retrievalDepth === "cold",
    },
    timings,
    cache: {
      packetHitCount: packetRows.length,
      canonicalHitCount: scopedItems.filter((item) => item.sourceRefs.some((ref) => ref.type === "canonical_memory")).length,
      ciphertextCacheHitCount: 0,
      walrusReadCount: 0,
      sealDecryptCount: 0,
    },
    warnings,
  };
}

export function defaultRetrievalDepth(
  surface: ContextRuntimeSurface,
  mode: ContextRuntimeMode,
): ContextRuntimeRetrievalDepth {
  if (surface === "voice_chat" || surface === "onboarding_voice" || mode === "voice_turn") {
    return "hot";
  }
  if (surface === "mcp" || surface === "cli" || mode === "agent_context") {
    return "warm";
  }
  if (mode === "document_qa" || mode === "memory_search") {
    return "warm";
  }
  return "warm";
}

function filterItemsForSurface(
  items: ContextRuntimeItem[],
  surface: ContextRuntimeSurface,
  mode: ContextRuntimeMode,
): ContextRuntimeItem[] {
  if (surface === "mcp" || surface === "cli" || mode === "agent_context") {
    return items.filter((item) => item.kind === "engineering_memory" || item.kind === "core_profile");
  }

  if (mode === "document_qa") {
    return items.filter((item) => item.kind === "core_profile" || item.kind === "context_packet");
  }

  return items.filter((item) => item.kind !== "engineering_memory");
}

function resolveRuntimeStatus(input: {
  items: ContextRuntimeItem[];
  retrievalDepth: ContextRuntimeRetrievalDepth;
  wantsColdEvidence: boolean;
  latencyBudgetMs: number;
  elapsedMs: number;
}): ContextRuntimeResult["status"] {
  if (input.wantsColdEvidence) {
    return input.items.length > 0 ? "partial" : "cold_required";
  }
  if (input.items.length === 0) {
    return input.retrievalDepth === "cold" ? "cold_required" : "partial";
  }
  if (input.elapsedMs > input.latencyBudgetMs) {
    return "partial";
  }
  return "ready";
}

function collectSourceRefs(items: ContextRuntimeItem[]): ContextRuntimeSourceRef[] {
  const sourceRefs = new Map<string, ContextRuntimeSourceRef>();

  for (const item of items) {
    for (const sourceRef of item.sourceRefs) {
      sourceRefs.set(`${sourceRef.type}:${sourceRef.id}`, sourceRef);
    }
  }

  return Array.from(sourceRefs.values());
}
