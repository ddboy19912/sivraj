type GraphPatternNodeInput = {
  properties: unknown;
};

export function filterVisibleGraphNodesByPatternEvidence<T extends GraphPatternNodeInput>(
  nodes: T[],
  canonicalMemoryIdsByCandidateId: Map<string, string>,
): T[] {
  return nodes.filter((node) =>
    shouldExposeGraphNodeProperties(node.properties, canonicalMemoryIdsByCandidateId),
  );
}

export function collectPatternCandidateMemoryIds(nodes: GraphPatternNodeInput[]) {
  return Array.from(new Set(nodes.flatMap((node) => {
    const properties = asRecord(node.properties);
    return isPatternNode(properties) ? readStringArray(properties, "candidateMemoryIds") : [];
  })));
}

export function shouldExposeGraphNodeProperties(
  propertiesValue: unknown,
  canonicalMemoryIdsByCandidateId: Map<string, string>,
) {
  const properties = asRecord(propertiesValue);
  if (!isPatternNode(properties)) {
    return true;
  }

  const candidateMemoryIds = readStringArray(properties, "candidateMemoryIds");
  const canonicalMemoryIds = readStringArray(properties, "canonicalMemoryIds");

  if (canonicalMemoryIds.length > 0) {
    return unique(canonicalMemoryIds).length >= 2;
  }

  const resolvedCanonicalMemoryIds = candidateMemoryIds
    .map((candidateMemoryId) => canonicalMemoryIdsByCandidateId.get(candidateMemoryId))
    .filter((value): value is string => Boolean(value));

  if (resolvedCanonicalMemoryIds.length > 0) {
    return unique(resolvedCanonicalMemoryIds).length >= 2;
  }

  return unique(candidateMemoryIds).length >= 2;
}

function isPatternNode(properties: Record<string, unknown>) {
  return properties.kind === "pattern";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readStringArray(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => (
      typeof item === "string" && item.trim().length > 0
    ))
    .map((item) => item.trim());
}

function unique(values: string[]) {
  return Array.from(new Set(values));
}
