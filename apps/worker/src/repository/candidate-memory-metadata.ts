export function buildCandidateConsolidationMetadata(input: {
  metadata: Record<string, unknown>;
  canonicalMemory: {
    id: string;
    canonicalKey: string;
    existing: boolean;
    semanticMerge?: {
      decision: "same" | "related" | "conflicting" | "separate";
      confidence: number;
      reason: string;
      canonicalMemoryId: string | null;
    };
  };
}) {
  const consolidation = input.canonicalMemory.existing
    ? input.canonicalMemory.semanticMerge?.decision === "same"
      ? "semantically_merged_into_existing_canonical_memory"
      : "merged_into_existing_canonical_memory"
    : "created_canonical_memory";

  return {
    ...input.metadata,
    canonicalMemoryId: input.canonicalMemory.id,
    canonicalKey: input.canonicalMemory.canonicalKey,
    consolidation,
    ...(input.canonicalMemory.semanticMerge
      ? { semanticMerge: input.canonicalMemory.semanticMerge }
      : {}),
  };
}
