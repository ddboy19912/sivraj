import { truncate } from "./helpers.js";

export function sanitizeAssistantContent(content: string): string {
  return content
    .replace(/\s*\[MEM_\d+\]/g, "")
    .replace(/\s*\[M(?:E(?:M(?:_\d*)?)?)?$/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function sanitizeSivrajVoiceReply(content: string): string | null {
  const text = content
    .replace(/^```(?:\w+)?/u, "")
    .replace(/```$/u, "")
    .replace(/^["'`]+|["'`]+$/gu, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!text) {
    return null;
  }

  return truncate(text, 180);
}

export function sanitizeConversationSpeaker(value: string) {
  return value
    .replace(/[/:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "Unknown";
}
