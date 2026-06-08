import type { ChatMessagePreview } from '@/lib/ai-chat/message-preview'
import { readClaudeConversationMessages } from '@/lib/ai-chat/claude-conversation'
import { isRecord } from '@/lib/ai-chat/is-record'
import { getConversationArray } from '@/lib/ai-chat/parse-arrays'

export function extractClaudeMessages(value: unknown): ChatMessagePreview[] {
  return getConversationArray(value).flatMap((conversation) => {
    if (!isRecord(conversation)) {
      return []
    }

    return readClaudeConversationMessages(conversation)
  })
}
