import type { candidateMemories, userFeedbackEvents } from "@sivraj/db";

type CandidateMemoryRow = typeof candidateMemories.$inferSelect;
type FeedbackEventRow = typeof userFeedbackEvents.$inferSelect;

export function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}

export function mergeStringArrays(...arrays: string[][]): string[] {
  return Array.from(new Set(arrays.flat().map((value) => value.trim()).filter(Boolean)));
}

export function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

export function readNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function readHandles(value: unknown): Record<string, string[]> {
  const record = asRecord(value);
  const handles: Record<string, string[]> = {};

  for (const [key, item] of Object.entries(record)) {
    handles[key] = readStringArray(item);
  }

  return handles;
}

export function summarizeCandidateSubjects(
  rows: Array<{
    memoryType: CandidateMemoryRow["memoryType"];
    metadata: unknown;
  }>,
): Array<{
  subject: string;
  memoryType: CandidateMemoryRow["memoryType"];
  count: number;
}> {
  const counts = new Map<string, {
    subject: string;
    memoryType: CandidateMemoryRow["memoryType"];
    count: number;
  }>();

  for (const row of rows) {
    const subject = asRecord(row.metadata).subject;

    if (typeof subject !== "string" || !subject.trim()) {
      continue;
    }

    const key = `${row.memoryType}:${subject.trim().toLowerCase()}`;
    const current = counts.get(key);

    if (current) {
      current.count += 1;
      continue;
    }

    counts.set(key, {
      subject: subject.trim(),
      memoryType: row.memoryType,
      count: 1,
    });
  }

  return Array.from(counts.values())
    .sort((a, b) => b.count - a.count || a.subject.localeCompare(b.subject))
    .slice(0, 30);
}

export function summarizeFeedbackTypes(
  rows: Array<{ feedbackType: FeedbackEventRow["feedbackType"] }>,
): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const row of rows) {
    counts[row.feedbackType] = (counts[row.feedbackType] ?? 0) + 1;
  }

  return counts;
}
