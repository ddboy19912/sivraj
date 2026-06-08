import { asString } from "@/helpers/data.helpers";
import { isRecord } from "@/lib/ai-chat/is-record";

const NESTED_TEXT_ARRAY_KEYS = ["parts", "content"] as const;

export function extractText(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }

  if (Array.isArray(value)) {
    return value
      .flatMap((item) => {
        const text = extractText(item);
        return text ? [text] : [];
      })
      .join("\n")
      .trim();
  }

  if (!isRecord(value)) {
    return "";
  }

  for (const key of NESTED_TEXT_ARRAY_KEYS) {
    const nested = value[key];

    if (Array.isArray(nested)) {
      return nested
        .flatMap((item) => {
          const text = extractText(item);
          return text ? [text] : [];
        })
        .join("\n")
        .trim();
    }
  }

  return (asString(value.text) ?? asString(value.message) ?? "").trim();
}
