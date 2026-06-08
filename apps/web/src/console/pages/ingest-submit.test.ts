import { describe, expect, it } from 'vitest'
import {
  buildIngestUploadMetadata,
  validateIngestSubmitInput,
} from '@/console/pages/ingest-submit'

describe('ingest submit helpers', () => {
  it('validates ingest form input', () => {
    expect(validateIngestSubmitInput({ sessionReady: false, content: 'hello' })).toEqual({
      ok: false,
      message: 'Sign in with the connected wallet before testing ingestion.',
    })
  })

  it('builds chat export metadata', () => {
    expect(buildIngestUploadMetadata({
      uploadMetadata: { fileName: 'export.json' },
      sourceType: 'chat_export',
      aiChatPreview: {
        provider: 'chatgpt',
        fingerprint: 'abc',
        messageCount: 2,
        conversations: [{ sourceConversationId: '1', title: 'Planning', messageCount: 2, firstMessageAt: null, lastMessageAt: null, sourceMessageIds: [] }],
      },
    })).toMatchObject({
      fileName: 'export.json',
      aiChatProvider: 'chatgpt',
      aiChatMessageCount: 2,
    })
  })
})
