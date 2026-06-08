import { parseJson } from '@/lib/ai-chat/import-json'
import { getConversationArray, isRecord } from '@/lib/ai-chat/parse-arrays'

export function isLikelyAiChatExportFile(file: File, content: string) {
  const name = file.name.toLowerCase()

  if (
    name.includes('chatgpt') ||
    name.includes('openai') ||
    name.includes('claude') ||
    name.includes('anthropic') ||
    name === 'conversations.json'
  ) {
    return true
  }

  const parsed = parseJson(content)
  const conversations = getConversationArray(parsed)

  return conversations.some((conversation) =>
    isRecord(conversation) &&
    (isRecord(conversation.mapping) ||
      Array.isArray(conversation.chat_messages) ||
      typeof conversation.uuid === 'string'),
  )
}
