import { describe, expect, it } from 'vitest'
import { buildAiChatImportPreview } from '@/lib/ai-chat/import-build'
import { isLikelyAiChatExportFile } from '@/lib/ai-chat/import-detect'

describe('ai chat import', () => {
  it('builds a chatgpt preview from export json', async () => {
    const content = JSON.stringify([
      {
        title: 'Planning',
        mapping: {
          'msg-1': {
            id: 'msg-1',
            message: {
              id: 'msg-1',
              author: { role: 'user' },
              content: { parts: ['Hello there'] },
              create_time: 1_700_000_000,
            },
          },
        },
      },
    ])

    await expect(buildAiChatImportPreview(content)).resolves.toEqual({
      provider: 'chatgpt',
      messageCount: 1,
      fingerprint: expect.any(String),
      conversations: [
        expect.objectContaining({
          title: 'Planning',
          messageCount: 1,
          sourceMessageIds: ['msg-1'],
        }),
      ],
    })
  })

  it('detects likely ai chat export files by name', () => {
    const file = new File(['{}'], 'chatgpt-export.json', {
      type: 'application/json',
    })

    expect(isLikelyAiChatExportFile(file, '{}')).toBe(true)
  })

  it('returns null for invalid json', async () => {
    await expect(buildAiChatImportPreview('not-json')).resolves.toBeNull()
  })
})
