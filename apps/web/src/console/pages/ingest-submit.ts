import type { AiChatImportPreview } from '@/types/chat.types'

export function validateIngestSubmitInput(input: {
  sessionReady: boolean
  content: string
}) {
  if (!input.sessionReady) {
    return { ok: false as const, message: 'Sign in with the connected wallet before testing ingestion.' }
  }

  if (!input.content.trim()) {
    return { ok: false as const, message: 'Content is required.' }
  }

  return { ok: true as const }
}

export function buildIngestUploadMetadata(input: {
  uploadMetadata: Record<string, unknown> | null
  sourceType: string
  aiChatPreview: AiChatImportPreview | null
}) {
  return {
    ...(input.uploadMetadata ?? {}),
    ...(input.sourceType === 'chat_export' && input.aiChatPreview
      ? {
          aiChatProvider: input.aiChatPreview.provider,
          aiChatImportKind: 'export',
          aiChatImportFingerprint: input.aiChatPreview.fingerprint,
          aiChatConversationCount: input.aiChatPreview.conversations.length,
          aiChatMessageCount: input.aiChatPreview.messageCount,
        }
      : {}),
  }
}
