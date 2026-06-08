import { extractClaudeMessages } from '@/lib/ai-chat/claude-messages'
import { extractChatGptMessages, extractGenericMessages } from '@/lib/ai-chat/open-messages'
import { buildConversationPreviews } from '@/lib/ai-chat/conversation-preview'
import { sha256Text } from '@/lib/ai-chat/import-crypto'
import { parseJson } from '@/lib/ai-chat/import-json'
import type { AiChatImportPreview, AiChatProvider } from '@/types/chat.types'

export async function buildAiChatImportPreview(content: string): Promise<AiChatImportPreview | null> {
  const parsed = parseJson(content)

  if (!parsed) {
    return null
  }

  const chatGptMessages = extractChatGptMessages(parsed)
  const claudeMessages = chatGptMessages.length > 0 ? [] : extractClaudeMessages(parsed)
  const provider: AiChatProvider = chatGptMessages.length > 0
    ? 'chatgpt'
    : claudeMessages.length > 0
      ? 'claude'
      : 'generic_chat'
  const messages = chatGptMessages.length > 0
    ? chatGptMessages
    : claudeMessages.length > 0
      ? claudeMessages
      : extractGenericMessages(parsed)

  if (messages.length === 0) {
    return null
  }

  const conversations = buildConversationPreviews(messages)
  const fingerprint = await sha256Text(JSON.stringify({
    version: 1,
    provider,
    conversations: conversations.map((conversation) => ({
      id: conversation.sourceConversationId,
      title: conversation.title,
      messageCount: conversation.messageCount,
      firstMessageAt: conversation.firstMessageAt,
      lastMessageAt: conversation.lastMessageAt,
      sourceMessageIds: conversation.sourceMessageIds,
    })),
  }))

  return {
    provider,
    conversations,
    messageCount: messages.length,
    fingerprint,
  }
}
