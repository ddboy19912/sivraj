import { isRecord } from "../shared/json.js";
import type { ChatExportExtraction, ChatMessage } from "./types.js";

export function extractGenericMessages(value: unknown): ChatExportExtraction {
  if (Array.isArray(value)) {
    return { provider: "generic", messages: value.filter(isRecord) as ChatMessage[] };
  }

  if (isRecord(value)) {
    for (const key of ["messages", "conversations", "items"]) {
      const candidate = value[key];

      if (Array.isArray(candidate)) {
        return { provider: "generic", messages: candidate.filter(isRecord) as ChatMessage[] };
      }
    }
  }

  return { provider: "generic", messages: [] };
}
