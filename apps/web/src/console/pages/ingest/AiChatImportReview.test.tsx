import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AiChatImportReview } from '@/console/pages/ingest/AiChatImportReview'
import type { AiChatImportPreview } from '@/types/chat.types'

const preview: AiChatImportPreview = {
  provider: 'claude',
  messageCount: 2,
  fingerprint: 'fp-1',
  conversations: [
    {
      sourceConversationId: 'conv-1',
      title: 'Planning',
      messageCount: 2,
      firstMessageAt: '2026-01-01T00:00:00.000Z',
      lastMessageAt: '2026-01-02T00:00:00.000Z',
      sourceMessageIds: ['m-1', 'm-2'],
    },
  ],
}

describe('AiChatImportReview', () => {
  it('shows an empty state without preview data', () => {
    render(<AiChatImportReview preview={null} receipt={null} />)
    expect(screen.getByText('No conversations detected yet.')).toBeInTheDocument()
  })

  it('renders conversation review details', () => {
    render(
      <AiChatImportReview
        preview={preview}
        receipt={{
          artifactId: 'artifact-id',
          memoryFragmentId: null,
          status: 'queued',
          storageMode: 'walrus',
          rawStorageRef: null,
          processingJobId: 'job-id',
          skipped: false,
        }}
      />,
    )

    expect(screen.getByText('Planning')).toBeInTheDocument()
    expect(screen.getByText('claude')).toBeInTheDocument()
    expect(screen.getAllByText('Imported')).toHaveLength(2)
  })
})
