import {
  CONTEXT_RUNTIME_MODES,
  CONTEXT_RUNTIME_RETRIEVAL_DEPTHS,
  CONTEXT_RUNTIME_SURFACES,
  type ContextRuntimeMode,
  type ContextRuntimeRetrievalDepth,
  type ContextRuntimeSurface,
} from "./types.js";

export function readContextRuntimeSurface(value: unknown): ContextRuntimeSurface | null {
  return readEnum(value, CONTEXT_RUNTIME_SURFACES);
}

export function readContextRuntimeMode(value: unknown): ContextRuntimeMode | null {
  return readEnum(value, CONTEXT_RUNTIME_MODES);
}

export function readContextRuntimeRetrievalDepth(value: unknown): ContextRuntimeRetrievalDepth | null {
  return readEnum(value, CONTEXT_RUNTIME_RETRIEVAL_DEPTHS);
}

export function readLatencyBudgetMs(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(Math.max(Math.floor(value), 50), 30_000);
}

export function readStringValue(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function readStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(readStringValue)
    .filter((item): item is string => Boolean(item));
}

export function readRecordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readEnum<T extends readonly string[]>(value: unknown, allowed: T): T[number] | null {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? value as T[number]
    : null;
}
