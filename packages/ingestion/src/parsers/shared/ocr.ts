import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ParsedArtifact } from "../../types.js";
import { normalizeOcrLineText } from "./text.js";

const execFileAsync = promisify(execFile);

export type OcrCommandRunner = (
  command: string,
  args: string[],
) => Promise<{ stdout: string; stderr: string }>;

export function readBase64Payload(content: string): Buffer {
  const trimmed = content.trim();
  const base64 = trimmed.startsWith("data:")
    ? (trimmed.split(",", 2)[1] ?? "")
    : trimmed;

  if (!base64) {
    return Buffer.alloc(0);
  }

  return Buffer.from(base64, "base64");
}

export async function defaultOcrCommandRunner(
  command: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(command, args, {
    maxBuffer: 20 * 1024 * 1024,
  });
}

export function normalizeOcrText(content: string): string {
  return normalizeOcrLineText(content);
}

export function createEmptyParseResult(
  parserName: string,
  originalLength: number,
  warnings: string[],
): ParsedArtifact {
  return {
    content: "",
    parser: {
      name: parserName,
      originalLength,
      parsedLength: 0,
      warnings,
    },
  };
}
