import { asString } from "@/helpers/data.helpers";
import { isRecord } from "@/lib/ai-chat/is-record";

export { asString, isRecord };

const CONVERSATION_ARRAY_KEYS = ["conversations", "chats", "items"] as const;

export function firstArray(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const candidate = record[key];

    if (Array.isArray(candidate)) {
      return candidate;
    }
  }

  return null;
}

export function getConversationArray(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }

  if (!isRecord(value)) {
    return [];
  }

  return firstArray(value, [...CONVERSATION_ARRAY_KEYS]) ?? [value];
}
