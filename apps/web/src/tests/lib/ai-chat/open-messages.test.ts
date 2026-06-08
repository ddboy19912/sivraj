import { describe, expect, it } from 'vitest'
import { extractChatGptMessages, extractGenericMessages } from '@/lib/ai-chat/open-messages'

describe('extractChatGptMessages', () => {
  it('extracts mapped chatgpt export messages', () => {
    expect(
      extractChatGptMessages([
        {
          title: 'Planning',
          id: 'conv-1',
          mapping: {
            node: {
              message: {
                id: 'msg-1',
                create_time: 1_704_067_200,
                content: { parts: ['Hello there'] },
              },
            },
          },
        },
      ]),
    ).toEqual([
      {
        sourceConversationId: 'conv-1',
        title: 'Planning',
        timestamp: expect.any(String),
        sourceMessageId: 'msg-1',
        text: 'Hello there',
      },
    ])
  })
})

describe('extractGenericMessages', () => {
  it('extracts generic message arrays', () => {
    expect(
      extractGenericMessages([
        { id: 'm-1', created_at: '2026-01-01T00:00:00.000Z', content: 'Hi' },
      ]),
    ).toEqual([
      {
        sourceConversationId: null,
        title: null,
        timestamp: '2026-01-01T00:00:00.000Z',
        sourceMessageId: 'm-1',
        text: 'Hi',
      },
    ])
  })
})
