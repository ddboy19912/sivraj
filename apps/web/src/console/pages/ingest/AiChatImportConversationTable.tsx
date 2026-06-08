import { AiChatImportConversationRow } from '@/console/pages/ingest/AiChatImportConversationRow'
import type { AiChatImportPreview } from '@/types/chat.types'
import type { ArtifactReceipt } from '@/types/console.types'

export function AiChatImportConversationTable({
  preview,
  receipt,
}: {
  preview: AiChatImportPreview
  receipt: ArtifactReceipt | null
}) {
  return (
    <div className="console-table-wrap">
      <table className="console-table">
        <thead>
          <tr>
            <th>Conversation</th>
            <th>Messages</th>
            <th>First</th>
            <th>Last</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {preview.conversations.map((conversation, index) => (
            <AiChatImportConversationRow
              key={
                conversation.sourceConversationId ??
                `${conversation.title ?? 'conversation'}-${index}`
              }
              conversation={conversation}
              receipt={receipt}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}
