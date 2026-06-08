import type { ChatExportConversationMetadata, ChatExportParserMetadata } from "../../types.js";
import { normalizeTimestamp } from "./timestamps.js";
import type { ChatExportProvider, ChatMessage } from "./types.js";

export function buildChatExportMetadata(
  provider: ChatExportProvider,
  messages: ChatMessage[],
): ChatExportParserMetadata {
  const conversations = new Map<string, ChatExportConversationMetadata>();

  for (const message of messages) {
    const key = message.sourceConversationId ?? message.conversationTitle ?? "default";
    const timestamp = normalizeTimestamp(
      message.timestamp ?? message.created_at ?? message.createdAt ?? message.create_time ?? message.date,
    );
    const current = conversations.get(key) ?? createConversationMetadataSeed(message);
    conversations.set(key, applyMessageToConversationMetadata(current, message, timestamp));
  }

  return {
    provider,
    conversations: Array.from(conversations.values()).map((conversation) => {
      const { sourceMessageIds, ...rest } = conversation;

      return {
        ...rest,
        ...(sourceMessageIds?.length ? { sourceMessageIds } : {}),
      };
    }),
  };
}

function createConversationMetadataSeed(message: ChatMessage): ChatExportConversationMetadata {
  return {
    ...(message.sourceConversationId ? { sourceConversationId: message.sourceConversationId } : {}),
    ...(message.conversationTitle ? { title: message.conversationTitle } : {}),
    messageCount: 0,
    sourceMessageIds: [],
  };
}

function applyMessageToConversationMetadata(
  current: ChatExportConversationMetadata,
  message: ChatMessage,
  timestamp: string | undefined,
): ChatExportConversationMetadata {
  const next = { ...current, messageCount: current.messageCount + 1 };

  if (timestamp) {
    if (!next.firstMessageAt || Date.parse(timestamp) < Date.parse(next.firstMessageAt)) {
      next.firstMessageAt = timestamp;
    }

    if (!next.lastMessageAt || Date.parse(timestamp) > Date.parse(next.lastMessageAt)) {
      next.lastMessageAt = timestamp;
    }
  }

  if (
    message.sourceMessageId &&
    next.sourceMessageIds &&
    !next.sourceMessageIds.includes(message.sourceMessageId)
  ) {
    next.sourceMessageIds = [...next.sourceMessageIds, message.sourceMessageId];
  }

  return next;
}
