import { describe, expect, it } from 'vitest'
import { getConversationArray } from '@/lib/ai-chat/parse-arrays'
import { normalizeTimestamp } from '@/lib/ai-chat/parse-timestamp'

describe('ai chat parse helpers', () => {
  it('reads conversation arrays from export payloads', () => {
    expect(getConversationArray({ conversations: [{ id: '1' }] })).toHaveLength(1)
  })

  it('normalizes unix timestamps', () => {
    expect(normalizeTimestamp(1_700_000_000)).toBe(new Date(1_700_000_000_000).toISOString())
  })
})
