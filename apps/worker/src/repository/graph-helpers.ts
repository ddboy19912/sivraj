import { mergeStringArrays, readNumber, readStringArray, asRecord } from "./helpers.js";

export function normalizeGraphNodeName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

export function mergeGraphNodeProperties(
  existing: unknown,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const existingRecord = asRecord(existing);
  const now = new Date().toISOString();
  const aliases = mergeStringArrays(
    readStringArray(existingRecord.aliases),
    readStringArray(incoming.aliases),
  );
  const sourceTypes = mergeStringArrays(
    readStringArray(existingRecord.sourceTypes),
    readStringArray(incoming.sourceTypes),
    typeof incoming.sourceType === "string" ? [incoming.sourceType] : [],
  );
  const mentionCount =
    readNumber(existingRecord.mentionCount) +
    Math.max(1, readNumber(incoming.mentionCount));

  return {
    ...existingRecord,
    ...incoming,
    aliases,
    sourceTypes,
    mentionCount,
    firstSeenAt:
      typeof existingRecord.firstSeenAt === "string"
        ? existingRecord.firstSeenAt
        : now,
    lastSeenAt: now,
  };
}
