import type { ChatMessagePreview } from '@/lib/ai-chat/message-preview'
import { asString, firstArray, isRecord } from '@/lib/ai-chat/parse-arrays'
import { normalizeTimestamp } from '@/lib/ai-chat/parse-timestamp'
import { extractText } from '@/lib/ai-chat/text-extract'

export function readClaudeConversationMessages(
  conversation: Record<string, unknown>,
): ChatMessagePreview[] {
  const title = asString(conversation.name) ?? asString(conversation.title) ?? null
  const sourceConversationId = asString(conversation.uuid) ?? asString(conversation.id) ?? null
  const messages = Array.isArray(conversation.chat_messages)
    ? conversation.chat_messages
    : title || sourceConversationId
      ? firstArray(conversation, ['messages', 'items']) ?? []
      : []

  return messages.flatMap((message) => {
    if (!isRecord(message)) {
      return []
    }

    const preview = {
      sourceConversationId,
      title,
      timestamp: normalizeTimestamp(message.created_at ?? message.updated_at ?? message.timestamp),
      sourceMessageId: asString(message.uuid) ?? asString(message.id) ?? null,
      text: extractText(message.content ?? message.text ?? message.message),
    }

    return preview.text.length > 0 ? [preview] : []
  })
}
