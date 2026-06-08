import type { ChatMessagePreview } from '@/lib/ai-chat/message-preview'
import { compareChatMessagesByTimestamp } from '@/lib/ai-chat/message-sort'
import { asString, isRecord } from '@/lib/ai-chat/parse-arrays'
import { normalizeTimestamp } from '@/lib/ai-chat/parse-timestamp'
import { extractText } from '@/lib/ai-chat/text-extract'

export function extractChatGptConversationMessages(
  conversation: Record<string, unknown>,
): ChatMessagePreview[] {
  if (!isRecord(conversation.mapping)) {
    return []
  }

  const title = asString(conversation.title) ?? asString(conversation.name) ?? null
  const sourceConversationId = asString(conversation.id) ?? asString(conversation.conversation_id) ?? null

  return Object.values(conversation.mapping).flatMap((node) => {
    if (!isRecord(node) || !isRecord(node.message)) {
      return []
    }

    const preview = {
      sourceConversationId,
      title,
      timestamp: normalizeTimestamp(node.message.create_time ?? node.message.update_time),
      sourceMessageId: asString(node.message.id) ?? null,
      text: extractText(node.message.content),
    }

    return preview.text.length > 0 ? [preview] : []
  }).sort(compareChatMessagesByTimestamp)
}
