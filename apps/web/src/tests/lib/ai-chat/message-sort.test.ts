import { describe, expect, it } from 'vitest'
import { compareChatMessagesByTimestamp } from '@/lib/ai-chat/message-sort'

describe('compareChatMessagesByTimestamp', () => {
  it('orders messages chronologically', () => {
    const left = {
      sourceConversationId: null,
      title: null,
      timestamp: '2026-01-02T00:00:00.000Z',
      sourceMessageId: null,
      text: 'later',
    }
    const right = {
      sourceConversationId: null,
      title: null,
      timestamp: '2026-01-01T00:00:00.000Z',
      sourceMessageId: null,
      text: 'earlier',
    }

    expect(compareChatMessagesByTimestamp(left, right)).toBeGreaterThan(0)
  })
})
