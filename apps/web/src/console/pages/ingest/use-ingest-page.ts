import { useState } from 'react'
import { createIngestPageActions } from '@/console/pages/ingest/ingest-page-actions'
import type { AiChatImportPreview } from '@/types/chat.types'
import { type SourceType } from '@/lib/encryption'
import { useConsoleContext } from '@/console/context'
import type { ArtifactReceipt } from '@/types/console.types'

export function useIngestPage() {
  const { session, isSessionForWallet, onSessionRefreshed, setArtifactId, setJobId } =
    useConsoleContext()
  const [sourceType, setSourceType] = useState<SourceType>('note')
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [uploadMetadata, setUploadMetadata] = useState<Record<string, unknown> | null>(null)
  const [aiChatPreview, setAiChatPreview] = useState<AiChatImportPreview | null>(null)
  const [receipt, setReceipt] = useState<ArtifactReceipt | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const actions = createIngestPageActions({
    session,
    isSessionForWallet,
    onSessionRefreshed,
    setArtifactId,
    setJobId,
    setSourceType,
    setContent,
    setUploadMetadata,
    setAiChatPreview,
    setReceipt,
    setStatus,
    setIsSubmitting,
  })

  return {
    aiChatPreview,
    content,
    handleContentChanged: (value: string) => void actions.handleContentChanged(value, sourceType),
    handleFileSelected: (event: React.ChangeEvent<HTMLInputElement>) =>
      void actions.handleFileSelected(event, sourceType),
    handleSourceTypeSelected: (value: SourceType) => void actions.handleSourceTypeSelected(value, content),
    handleSubmit: (event: React.FormEvent) =>
      void actions.handleSubmit(event, {
        sourceType,
        title,
        content,
        uploadMetadata,
        aiChatPreview,
      }),
    isSessionForWallet,
    isSubmitting,
    receipt,
    sourceType,
    status,
    title,
    setTitle,
  }
}
