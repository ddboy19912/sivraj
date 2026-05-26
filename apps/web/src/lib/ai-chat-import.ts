export type AiChatProvider = 'chatgpt' | 'claude' | 'generic_chat'

export type AiChatConversationPreview = {
  sourceConversationId: string | null
  title: string | null
  messageCount: number
  firstMessageAt: string | null
  lastMessageAt: string | null
  sourceMessageIds: string[]
}

export type AiChatImportPreview = {
  provider: AiChatProvider
  conversations: AiChatConversationPreview[]
  messageCount: number
  fingerprint: string
}

type ChatMessagePreview = {
  sourceConversationId: string | null
  title: string | null
  timestamp: string | null
  sourceMessageId: string | null
  text: string
}

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

function extractChatGptMessages(value: unknown): ChatMessagePreview[] {
  return getConversationArray(value).flatMap((conversation) => {
    if (!isRecord(conversation) || !isRecord(conversation.mapping)) {
      return []
    }

    const title = asString(conversation.title) ?? asString(conversation.name) ?? null
    const sourceConversationId = asString(conversation.id) ?? asString(conversation.conversation_id) ?? null

    return Object.values(conversation.mapping)
      .map((node) => isRecord(node) && isRecord(node.message) ? node.message : null)
      .filter((message): message is Record<string, unknown> => Boolean(message))
      .map((message) => ({
        sourceConversationId,
        title,
        timestamp: normalizeTimestamp(message.create_time ?? message.update_time),
        sourceMessageId: asString(message.id) ?? null,
        text: extractText(message.content),
      }))
      .filter((message) => message.text.length > 0)
      .sort(compareMessages)
  })
}

function extractClaudeMessages(value: unknown): ChatMessagePreview[] {
  return getConversationArray(value).flatMap((conversation) => {
    if (!isRecord(conversation)) {
      return []
    }

    const title = asString(conversation.name) ?? asString(conversation.title) ?? null
    const sourceConversationId = asString(conversation.uuid) ?? asString(conversation.id) ?? null
    const messages = Array.isArray(conversation.chat_messages)
      ? conversation.chat_messages
      : title || sourceConversationId
        ? firstArray(conversation, ['messages', 'items']) ?? []
        : []

    return messages
      .filter(isRecord)
      .map((message) => ({
        sourceConversationId,
        title,
        timestamp: normalizeTimestamp(message.created_at ?? message.updated_at ?? message.timestamp),
        sourceMessageId: asString(message.uuid) ?? asString(message.id) ?? null,
        text: extractText(message.content ?? message.text ?? message.message),
      }))
      .filter((message) => message.text.length > 0)
  })
}

function extractGenericMessages(value: unknown): ChatMessagePreview[] {
  const messages = Array.isArray(value)
    ? value
    : isRecord(value)
      ? firstArray(value, ['messages', 'conversations', 'items']) ?? []
      : []

  return messages
    .filter(isRecord)
    .map((message) => ({
      sourceConversationId: null,
      title: null,
      timestamp: normalizeTimestamp(message.timestamp ?? message.created_at ?? message.createdAt ?? message.date),
      sourceMessageId: asString(message.id) ?? asString(message.uuid) ?? null,
      text: extractText(message.content ?? message.text ?? message.message),
    }))
    .filter((message) => message.text.length > 0)
}

function buildConversationPreviews(messages: ChatMessagePreview[]) {
  const conversations = new Map<string, AiChatConversationPreview>()

  for (const message of messages) {
    const key = message.sourceConversationId ?? message.title ?? 'default'
    const current = conversations.get(key) ?? {
      sourceConversationId: message.sourceConversationId,
      title: message.title,
      messageCount: 0,
      firstMessageAt: null,
      lastMessageAt: null,
      sourceMessageIds: [],
    }

    current.messageCount += 1

    if (message.timestamp) {
      if (!current.firstMessageAt || Date.parse(message.timestamp) < Date.parse(current.firstMessageAt)) {
        current.firstMessageAt = message.timestamp
      }

      if (!current.lastMessageAt || Date.parse(message.timestamp) > Date.parse(current.lastMessageAt)) {
        current.lastMessageAt = message.timestamp
      }
    }

    if (message.sourceMessageId && !current.sourceMessageIds.includes(message.sourceMessageId)) {
      current.sourceMessageIds.push(message.sourceMessageId)
    }

    conversations.set(key, current)
  }

  return Array.from(conversations.values()).sort((left, right) =>
    (left.firstMessageAt ?? left.title ?? '').localeCompare(right.firstMessageAt ?? right.title ?? ''),
  )
}

function parseJson(content: string): unknown {
  try {
    return JSON.parse(content) as unknown
  } catch {
    return null
  }
}

function getConversationArray(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value
  }

  if (!isRecord(value)) {
    return []
  }

  return firstArray(value, ['conversations', 'chats', 'items']) ?? [value]
}

function firstArray(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const candidate = record[key]

    if (Array.isArray(candidate)) {
      return candidate
    }
  }

  return null
}

function extractText(value: unknown): string {
  if (typeof value === 'string') {
    return value.trim()
  }

  if (Array.isArray(value)) {
    return value.map(extractText).filter(Boolean).join('\n').trim()
  }

  if (!isRecord(value)) {
    return ''
  }

  if (Array.isArray(value.parts)) {
    return value.parts.map(extractText).filter(Boolean).join('\n').trim()
  }

  if (Array.isArray(value.content)) {
    return value.content.map(extractText).filter(Boolean).join('\n').trim()
  }

  return (asString(value.text) ?? asString(value.message) ?? '').trim()
}

function normalizeTimestamp(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const milliseconds = value > 10_000_000_000 ? value : value * 1000
    return new Date(milliseconds).toISOString()
  }

  return asString(value) ?? null
}

function compareMessages(left: ChatMessagePreview, right: ChatMessagePreview) {
  const leftTime = Date.parse(left.timestamp ?? '')
  const rightTime = Date.parse(right.timestamp ?? '')

  if (Number.isNaN(leftTime) || Number.isNaN(rightTime)) {
    return 0
  }

  return leftTime - rightTime
}

function asString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

async function sha256Text(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}
