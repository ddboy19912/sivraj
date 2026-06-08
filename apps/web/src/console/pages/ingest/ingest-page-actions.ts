import {
  ingestErrorMessage,
  loadAiChatPreviewFromContent,
  loadAiChatPreviewFromFile,
  submitIngestArtifact,
} from '@/console/pages/ingest/ingest-page-handlers'
import type { AiChatImportPreview } from '@/types/chat.types'
import { type SourceType } from '@/lib/encryption'
import type { Session } from '@/lib/session'
import type { ArtifactReceipt } from '@/types/console.types'

type IngestPageActionInput = {
  session: Session | null
  isSessionForWallet: boolean
  onSessionRefreshed: (session: Session) => void
  setArtifactId: (id: string) => void
  setJobId: (id: string) => void
  setSourceType: (value: SourceType) => void
  setContent: (value: string) => void
  setUploadMetadata: (value: Record<string, unknown> | null) => void
  setAiChatPreview: (value: AiChatImportPreview | null) => void
  setReceipt: (value: ArtifactReceipt | null) => void
  setStatus: (value: string | null) => void
  setIsSubmitting: (value: boolean) => void
}

export function createIngestPageActions(input: IngestPageActionInput) {
  async function handleSubmit(
    event: React.FormEvent,
    form: {
      sourceType: SourceType
      title: string
      content: string
      uploadMetadata: Record<string, unknown> | null
      aiChatPreview: AiChatImportPreview | null
    },
  ) {
    event.preventDefault()

    if (!input.session || !input.isSessionForWallet) {
      input.setStatus('Sign in required.')
      return
    }

    input.setIsSubmitting(true)
    input.setStatus('Encrypting and uploading artifact...')

    try {
      const result = await submitIngestArtifact({
        session: input.session,
        onSessionRefreshed: input.onSessionRefreshed,
        ...form,
      })

      input.setReceipt(result)
      input.setArtifactId(result.artifactId)
      input.setJobId(result.processingJobId ?? '')
      input.setStatus(
        result.skipped
          ? 'Import skipped because this AI chat export was already imported.'
          : 'Artifact uploaded and queued.',
      )
    } catch (error) {
      input.setStatus(ingestErrorMessage(error))
    } finally {
      input.setIsSubmitting(false)
    }
  }

  async function handleFileSelected(
    event: React.ChangeEvent<HTMLInputElement>,
    currentSourceType: SourceType,
  ) {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }

    const loaded = await loadAiChatPreviewFromFile(file, currentSourceType)
    input.setSourceType(loaded.sourceType)
    input.setContent(loaded.text)
    input.setUploadMetadata(loaded.metadata)
    input.setAiChatPreview(loaded.sourceType === 'chat_export' ? loaded.preview : null)
    input.setStatus(`${file.name} loaded as ${loaded.sourceType} (${loaded.text.length} chars).`)
  }

  async function handleSourceTypeSelected(value: SourceType, content: string) {
    input.setSourceType(value)

    if (value === 'chat_export' && content.trim()) {
      input.setAiChatPreview(await loadAiChatPreviewFromContent(content))
      return
    }

    input.setAiChatPreview(null)
  }

  async function handleContentChanged(value: string, sourceType: SourceType) {
    input.setContent(value)

    if (sourceType === 'chat_export') {
      input.setAiChatPreview(await loadAiChatPreviewFromContent(value))
    }
  }

  return {
    handleContentChanged,
    handleFileSelected,
    handleSourceTypeSelected,
    handleSubmit,
  }
}
