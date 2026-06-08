import { extractChatGptMessages } from "./chatgpt-parser.js";
import { extractClaudeMessages } from "./claude-parser.js";
import { extractGenericMessages } from "./generic-extractor.js";
import type { ChatExportExtraction } from "./types.js";

export function extractMessages(value: unknown): ChatExportExtraction {
  const chatGptMessages = extractChatGptMessages(value);
  if (chatGptMessages.length > 0) {
    return { provider: "chatgpt", messages: chatGptMessages };
  }

  const claudeMessages = extractClaudeMessages(value);
  if (claudeMessages.length > 0) {
    return { provider: "claude", messages: claudeMessages };
  }

  return extractGenericMessages(value);
}
