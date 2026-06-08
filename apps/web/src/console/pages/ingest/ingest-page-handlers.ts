import {
  buildIngestUploadMetadata,
  validateIngestSubmitInput,
} from '@/console/pages/ingest-submit'
import { buildAiChatImportPreview } from '@/lib/ai-chat/import-build'
import { isLikelyAiChatExportFile } from '@/lib/ai-chat/import-detect'
import type { AiChatImportPreview } from '@/types/chat.types'
import { errorMessage, postAuthedJson } from '@/lib/api'
import { buildClientEncryptedArtifactBody, type SourceType } from '@/lib/encryption'
import { buildUploadMetadata, inferUploadSourceType } from '@/lib/ingest/upload-source-type'
import type { Session } from '@/lib/session'
import type { ArtifactReceipt } from '@/types/console.types'

function resolveUploadedSourceType(
  currentSourceType: SourceType,
  file: File,
  text: string,
  preview: AiChatImportPreview | null,
): SourceType {
  if (currentSourceType === 'browser_history') {
    return currentSourceType
  }

  if (preview && isLikelyAiChatExportFile(file, text)) {
    return 'chat_export'
  }

  return inferUploadSourceType(file)
}

export async function submitIngestArtifact(input: {
  session: Session
  onSessionRefreshed: (session: Session) => void
  sourceType: SourceType
  title: string
  content: string
  uploadMetadata: Record<string, unknown> | null
  aiChatPreview: AiChatImportPreview | null
}) {
  const validation = validateIngestSubmitInput({
    sessionReady: true,
    content: input.content,
  })

  if (!validation.ok) {
    throw new Error(validation.message)
  }

  const metadata = buildIngestUploadMetadata({
    uploadMetadata: input.uploadMetadata,
    sourceType: input.sourceType,
    aiChatPreview: input.aiChatPreview,
  })
  const encryptedBody = await buildClientEncryptedArtifactBody({
    sourceType: input.sourceType,
    title: input.title.trim() || null,
    content: input.content.trim(),
    metadata,
  })

  return postAuthedJson<ArtifactReceipt>(
    `/v1/twins/${input.session.twinId}/artifacts`,
    encryptedBody,
    input.session,
    input.onSessionRefreshed,
  )
}

export async function loadAiChatPreviewFromFile(
  file: File,
  currentSourceType: SourceType = 'note',
) {
  const text = await file.text()
  const preview = await buildAiChatImportPreview(text)
  const sourceType = resolveUploadedSourceType(currentSourceType, file, text, preview)
  const metadata = buildUploadMetadata(file, sourceType)

  return { text, preview, sourceType, metadata }
}

export async function loadAiChatPreviewFromContent(content: string) {
  return buildAiChatImportPreview(content)
}

export function ingestErrorMessage(error: unknown) {
  return errorMessage(error)
}
