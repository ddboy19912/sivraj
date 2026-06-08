import { isRecord } from "../shared/json.js";
import { asString, getConversationArray, pickDefined } from "./record-helpers.js";
import { compareMessagesByTimestamp, normalizeTimestamp } from "./timestamps.js";
import { extractTextContent } from "./text-content.js";
import type { ChatMessage } from "./types.js";

export function extractChatGptMessages(value: unknown): ChatMessage[] {
  const conversations = getConversationArray(value);
  const messages: ChatMessage[] = [];

  for (const conversation of conversations) {
    const mapping = isRecord(conversation.mapping) ? conversation.mapping : null;
    if (!mapping) {
      continue;
    }

    const conversationTitle = asString(conversation.title) ?? asString(conversation.name);
    const sourceConversationId = asString(conversation.id) ?? asString(conversation.conversation_id);
    const mappedMessages = Object.values(mapping)
      .map((node) => (isRecord(node) && isRecord(node.message) ? node.message : null))
      .filter((message): message is Record<string, unknown> => Boolean(message))
      .map((message) => mapChatGptExportMessage(message, { conversationTitle, sourceConversationId }))
      .filter((message) => extractTextContent(message.content).length > 0)
      .sort(compareMessagesByTimestamp);

    messages.push(...mappedMessages);
  }

  return messages;
}

function mapChatGptExportMessage(
  message: Record<string, unknown>,
  context: { conversationTitle?: string; sourceConversationId?: string },
): ChatMessage {
  const author = isRecord(message.author) ? message.author : {};
  const sourceSpeakerId = asString(author.role) ?? asString(author.name);

  return {
    author: sourceSpeakerId ?? "unknown",
    content: message.content,
    ...pickDefined({
      timestamp: normalizeTimestamp(message.create_time ?? message.update_time),
      conversationTitle: context.conversationTitle,
      sourceConversationId: context.sourceConversationId,
      sourceMessageId: asString(message.id),
      sourceSpeakerId,
    }),
  };
}
