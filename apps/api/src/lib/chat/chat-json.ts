import { readRecord } from "../http/route-helpers.js";

export function parseJsonObject(content: string): Record<string, unknown> | null {
  const trimmed = content.trim();
  const json = trimmed.match(/\{[\s\S]*\}/)?.[0] ?? trimmed;

  try {
    const parsed = JSON.parse(json);
    return readRecord(parsed);
  } catch {
    return null;
  }
}

export function clampConfidence(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }

  return Math.max(0, Math.min(1, numeric));
}
