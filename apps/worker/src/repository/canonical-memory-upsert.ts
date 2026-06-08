export function shouldApplySemanticCanonicalMerge(input: {
  decision: "same" | "related" | "conflicting" | "separate";
  canonicalMemoryId: string | null;
  confidence: number;
  threshold?: number;
}) {
  return input.decision === "same" &&
    Boolean(input.canonicalMemoryId) &&
    input.confidence >= (input.threshold ?? 0.78);
}

export function readCanonicalSubject(metadata: Record<string, unknown>) {
  return typeof metadata.subject === "string" && metadata.subject.trim()
    ? metadata.subject.trim()
    : null;
}
