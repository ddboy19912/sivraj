import { isRecord } from "../shared/json.js";
import { asString } from "./record-helpers.js";

export function extractTextContent(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(extractTextContent).filter(Boolean).join("\n");
  }

  if (!isRecord(value)) {
    return "";
  }

  if (Array.isArray(value.parts)) {
    return value.parts.map(extractTextContent).filter(Boolean).join("\n");
  }

  if (Array.isArray(value.content)) {
    return value.content.map(extractTextContent).filter(Boolean).join("\n");
  }

  return (
    asString(value.text) ??
    asString(value.message) ??
    asString(value.value) ??
    ""
  );
}
