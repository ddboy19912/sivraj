import type { ParsedConversationMessage } from "../../types.js";
import { normalizeWhitespaceText } from "../shared/text.js";
import { pickDefined } from "./record-helpers.js";
import { normalizeTimestamp } from "./timestamps.js";
import { extractTextContent } from "./text-content.js";
import type { ChatMessage } from "./types.js";

export function toConversationMessage(message: ChatMessage): ParsedConversationMessage | null {
  const content = normalizeWhitespaceText(extractTextContent(message.content ?? message.text ?? message.message));
  if (!content) {
    return null;
  }

  const author = readMessageAuthor(message);
  const timestamp = readMessageTimestamp(message);

  return {
    ...pickDefined({ timestamp, sourceSpeakerId: message.sourceSpeakerId }),
    speaker: formatConversationSpeaker(message, author),
    text: content,
  };
}

export function extractSpeakers(messages: ChatMessage[]): string[] {
  return Array.from(new Set(
    messages
      .map((message) => message.author ?? message.sender ?? message.role ?? message.name ?? "unknown")
      .map((speaker) => speaker.trim())
      .filter(Boolean),
  ));
}

function readMessageAuthor(message: ChatMessage): string {
  return message.author ?? message.sender ?? message.role ?? message.name ?? "unknown";
}

function readMessageTimestamp(message: ChatMessage): string | undefined {
  return normalizeTimestamp(
    message.timestamp ?? message.created_at ?? message.createdAt ?? message.create_time ?? message.date,
  );
}

function formatConversationSpeaker(message: ChatMessage, author: string): string {
  return message.conversationTitle ? `${author} (${message.conversationTitle})` : author;
}
