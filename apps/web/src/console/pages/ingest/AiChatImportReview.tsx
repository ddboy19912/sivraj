import { AiChatImportConversationTable } from '@/console/pages/ingest/AiChatImportConversationTable'
import { AiChatImportReviewHeader } from '@/console/pages/ingest/AiChatImportReviewHeader'
import type { AiChatImportPreview } from '@/types/chat.types'
import type { ArtifactReceipt } from '@/types/console.types'

type AiChatImportReviewProps = {
  preview: AiChatImportPreview | null
  receipt: ArtifactReceipt | null
}

export function AiChatImportReview({ preview, receipt }: AiChatImportReviewProps) {
  if (!preview) {
    return (
      <div className="console-panel">
        <h3>AI chat import review</h3>
        <p className="console-status">No conversations detected yet.</p>
      </div>
    )
  }

  return (
    <div className="console-panel">
      <AiChatImportReviewHeader receipt={receipt} />
      <dl className="console-mini-dl">
        <dt>Provider</dt>
        <dd>{preview.provider}</dd>
        <dt>Conversations</dt>
        <dd>{preview.conversations.length}</dd>
        <dt>Messages</dt>
        <dd>{preview.messageCount}</dd>
      </dl>
      <AiChatImportConversationTable preview={preview} receipt={receipt} />
    </div>
  )
}
