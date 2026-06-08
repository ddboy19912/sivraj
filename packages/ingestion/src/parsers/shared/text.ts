import type { ParsedConversationMessage } from "../../types.js";

function normalizeLineOrientedText(content: string): string[] {
  return content
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim());
}

export function normalizeWhitespaceText(content: string): string {
  return normalizeLineOrientedText(content)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function normalizeOcrLineText(content: string): string {
  return normalizeLineOrientedText(content)
    .filter(Boolean)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function renderConversationMessage(message: ParsedConversationMessage): string {
  return message.timestamp
    ? `[${message.timestamp}] ${message.speaker}: ${message.text}`
    : `${message.speaker}: ${message.text}`;
}
