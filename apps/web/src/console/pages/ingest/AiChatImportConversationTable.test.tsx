import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AiChatImportConversationTable } from '@/console/pages/ingest/AiChatImportConversationTable'
import type { AiChatImportPreview } from '@/types/chat.types'

const preview: AiChatImportPreview = {
  provider: 'claude',
  messageCount: 1,
  fingerprint: 'fp-1',
  conversations: [
    {
      sourceConversationId: 'conv-1',
      title: 'Planning',
      messageCount: 1,
      firstMessageAt: '2026-01-01T00:00:00.000Z',
      lastMessageAt: '2026-01-02T00:00:00.000Z',
      sourceMessageIds: ['m-1'],
    },
  ],
}

describe('AiChatImportConversationTable', () => {
  it('renders conversation rows and ready status', () => {
    render(<AiChatImportConversationTable preview={preview} receipt={null} />)

    expect(screen.getByText('Planning')).toBeInTheDocument()
    expect(screen.getByText('Ready')).toBeInTheDocument()
  })
})
