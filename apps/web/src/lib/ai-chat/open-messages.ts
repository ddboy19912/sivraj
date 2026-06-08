import type { ChatMessagePreview } from '@/lib/ai-chat/message-preview'
import { extractChatGptConversationMessages } from '@/lib/ai-chat/open-messages-chatgpt'
import { asString, firstArray, getConversationArray, isRecord } from '@/lib/ai-chat/parse-arrays'
import { normalizeTimestamp } from '@/lib/ai-chat/parse-timestamp'
import { extractText } from '@/lib/ai-chat/text-extract'

export function extractChatGptMessages(value: unknown): ChatMessagePreview[] {
  return getConversationArray(value).flatMap((conversation) => {
    if (!isRecord(conversation)) {
      return []
    }

    return extractChatGptConversationMessages(conversation)
  })
}

export function extractGenericMessages(value: unknown): ChatMessagePreview[] {
  const messages = Array.isArray(value)
    ? value
    : isRecord(value)
      ? firstArray(value, ['messages', 'conversations', 'items']) ?? []
      : []

  return messages.flatMap((message) => {
    if (!isRecord(message)) {
      return []
    }

    const preview = {
      sourceConversationId: null,
      title: null,
      timestamp: normalizeTimestamp(message.timestamp ?? message.created_at ?? message.createdAt ?? message.date),
      sourceMessageId: asString(message.id) ?? asString(message.uuid) ?? null,
      text: extractText(message.content ?? message.text ?? message.message),
    }

    return preview.text.length > 0 ? [preview] : []
  })
}
