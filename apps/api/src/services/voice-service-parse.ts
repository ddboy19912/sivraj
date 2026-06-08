import { parseSseDataLines, truncateText } from "@sivraj/core";

export function readFirstString(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const result = readFirstString(item);
      if (result) {
        return result;
      }
    }
  }

  if (value && typeof value === "object" && "data" in value) {
    return readFirstString((value as { data?: unknown }).data);
  }

  if (value && typeof value === "object" && "output" in value) {
    return readFirstString((value as { output?: unknown }).output);
  }

  return undefined;
}

export function parseGradioAudioResult(value: unknown): string {
  if (typeof value !== "string") {
    const result = readFirstString(value);
    if (result) {
      return result;
    }

    throw new Error(`voice_service_missing_audio:${truncateText(JSON.stringify(value))}`);
  }

  for (const line of parseSseDataLines(value).reverse()) {
    try {
      const parsed = JSON.parse(line) as unknown;
      const result = readFirstString(parsed);
      if (result) {
        return result;
      }
    } catch {
      if (line.length > 0) {
        return line;
      }
    }
  }

  throw new Error(`voice_service_missing_audio:${truncateText(value)}`);
}
