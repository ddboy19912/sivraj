import type { AiChatConversationPreview } from '@/types/chat.types'
import type { ChatMessagePreview } from '@/lib/ai-chat/message-preview'

function createEmptyConversationPreview(
  message: ChatMessagePreview,
): AiChatConversationPreview {
  return {
    sourceConversationId: message.sourceConversationId,
    title: message.title,
    messageCount: 0,
    firstMessageAt: null,
    lastMessageAt: null,
    sourceMessageIds: [],
  }
}

function updateMessageTimestampRange(
  preview: AiChatConversationPreview,
  timestamp: string,
): void {
  const parsed = Date.parse(timestamp)

  if (!preview.firstMessageAt || parsed < Date.parse(preview.firstMessageAt)) {
    preview.firstMessageAt = timestamp
  }

  if (!preview.lastMessageAt || parsed > Date.parse(preview.lastMessageAt)) {
    preview.lastMessageAt = timestamp
  }
}

function appendUniqueSourceMessageId(
  preview: AiChatConversationPreview,
  sourceMessageId: string,
): void {
  if (!preview.sourceMessageIds.includes(sourceMessageId)) {
    preview.sourceMessageIds.push(sourceMessageId)
  }
}

function sortConversationPreviews(
  conversations: AiChatConversationPreview[],
): AiChatConversationPreview[] {
  return conversations.sort((left, right) =>
    (left.firstMessageAt ?? left.title ?? '').localeCompare(
      right.firstMessageAt ?? right.title ?? '',
    ),
  )
}

export function buildConversationPreviews(messages: ChatMessagePreview[]) {
  const conversations = new Map<string, AiChatConversationPreview>()

  for (const message of messages) {
    const key = message.sourceConversationId ?? message.title ?? 'default'
    const current = conversations.get(key) ?? createEmptyConversationPreview(message)

    current.messageCount += 1

    if (message.timestamp) {
      updateMessageTimestampRange(current, message.timestamp)
    }

    if (message.sourceMessageId) {
      appendUniqueSourceMessageId(current, message.sourceMessageId)
    }

    conversations.set(key, current)
  }

  return sortConversationPreviews(Array.from(conversations.values()))
}
