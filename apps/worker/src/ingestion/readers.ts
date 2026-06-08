import { createHash } from "node:crypto";

export function readNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export function sha256Text(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function approximateBase64Bytes(value: string): number {
  return Math.ceil((value.length * 3) / 4);
}
