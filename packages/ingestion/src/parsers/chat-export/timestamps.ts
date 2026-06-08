import type { ChatMessage } from "./types.js";
import { asString } from "./record-helpers.js";

export function normalizeTimestamp(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    const milliseconds = value > 10_000_000_000 ? value : value * 1000;
    return new Date(milliseconds).toISOString();
  }

  return asString(value);
}

export function compareMessagesByTimestamp(left: ChatMessage, right: ChatMessage): number {
  const leftTimestamp = Date.parse(left.timestamp ?? "");
  const rightTimestamp = Date.parse(right.timestamp ?? "");

  if (Number.isNaN(leftTimestamp) || Number.isNaN(rightTimestamp)) {
    return 0;
  }

  return leftTimestamp - rightTimestamp;
}
