import { isRecord } from "../shared/json.js";
import { asString, firstArray, getConversationArray, pickDefined } from "./record-helpers.js";
import { extractTextContent } from "./text-content.js";
import type { ChatMessage } from "./types.js";

export function extractClaudeMessages(value: unknown): ChatMessage[] {
  return getConversationArray(value)
    .flatMap(extractMessagesFromClaudeConversation)
    .filter((message) => extractTextContent(message.content).length > 0);
}

function extractMessagesFromClaudeConversation(
  conversation: Record<string, unknown>,
): ChatMessage[] {
  const conversationTitle = asString(conversation.name) ?? asString(conversation.title);
  const sourceConversationId = asString(conversation.uuid) ?? asString(conversation.id);
  const hasClaudeConversationShape =
    Array.isArray(conversation.chat_messages) || Boolean(conversationTitle || sourceConversationId);

  if (!hasClaudeConversationShape) {
    return [];
  }

  const candidateMessages = firstArray(conversation, ["chat_messages", "messages", "items"]);
  if (!candidateMessages) {
    return [];
  }

  return candidateMessages
    .filter(isRecord)
    .map((candidateMessage) =>
      mapClaudeMessage(candidateMessage, { conversationTitle, sourceConversationId }),
    );
}

function readClaudeSpeakerId(message: Record<string, unknown>): string | undefined {
  return (
    asString(message.sender) ??
    asString(message.role) ??
    asString(message.author) ??
    asString(message.name)
  );
}

function readClaudeTimestamp(message: Record<string, unknown>): string | undefined {
  return (
    asString(message.created_at) ??
    asString(message.updated_at) ??
    asString(message.timestamp)
  );
}

function mapClaudeMessage(
  candidateMessage: Record<string, unknown>,
  context: { conversationTitle?: string; sourceConversationId?: string },
): ChatMessage {
  const sourceSpeakerId = readClaudeSpeakerId(candidateMessage);

  return {
    author: sourceSpeakerId ?? "unknown",
    content: candidateMessage.content ?? candidateMessage.text ?? candidateMessage.message,
    ...pickDefined({
      timestamp: readClaudeTimestamp(candidateMessage),
      conversationTitle: context.conversationTitle,
      sourceConversationId: context.sourceConversationId,
      sourceMessageId: asString(candidateMessage.uuid) ?? asString(candidateMessage.id),
      sourceSpeakerId,
    }),
  };
}
