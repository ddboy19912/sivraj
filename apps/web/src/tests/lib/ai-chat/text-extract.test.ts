import { describe, expect, it } from 'vitest'
import { extractText } from '@/lib/ai-chat/text-extract'

describe('ai chat text extract', () => {
  it('extracts nested chat text', () => {
    expect(extractText({ content: [{ text: 'Hello' }] })).toBe('Hello')
  })
})
