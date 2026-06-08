import { describe, expect, it } from 'vitest'
import { readClaudeConversationMessages } from '@/lib/ai-chat/claude-conversation'
import { extractClaudeMessages } from '@/lib/ai-chat/claude-messages'

describe('readClaudeConversationMessages', () => {
  it('reads mapping-based claude conversations', () => {
    expect(
      readClaudeConversationMessages({
        title: 'Mapped',
        id: 'conv-2',
        messages: [{ id: 'msg-2', created_at: '2026-02-01T00:00:00.000Z', text: 'Mapped text' }],
      }),
    ).toEqual([
      {
        sourceConversationId: 'conv-2',
        title: 'Mapped',
        timestamp: '2026-02-01T00:00:00.000Z',
        sourceMessageId: 'msg-2',
        text: 'Mapped text',
      },
    ])
  })
})

describe('extractClaudeMessages', () => {
  it('extracts claude export messages', () => {
    expect(extractClaudeMessages([{
      uuid: 'conv-1',
      name: 'Planning',
      chat_messages: [{
        uuid: 'msg-1',
        created_at: '2026-01-01T00:00:00.000Z',
        content: [{ text: 'Hello there' }],
      }],
    }])).toEqual([{
      sourceConversationId: 'conv-1',
      title: 'Planning',
      timestamp: '2026-01-01T00:00:00.000Z',
      sourceMessageId: 'msg-1',
      text: 'Hello there',
    }])
  })
})
