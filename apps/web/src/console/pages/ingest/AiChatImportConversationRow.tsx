import type { AiChatConversationPreview } from '@/types/chat.types'
import type { ArtifactReceipt } from '@/types/console.types'

export function AiChatImportConversationRow({
  conversation,
  receipt,
}: {
  conversation: AiChatConversationPreview
  receipt: ArtifactReceipt | null
}) {
  return (
    <tr>
      <td>
        {conversation.title ??
          conversation.sourceConversationId ??
          'Untitled conversation'}
      </td>
      <td>{conversation.messageCount}</td>
      <td>{conversation.firstMessageAt ?? '—'}</td>
      <td>{conversation.lastMessageAt ?? '—'}</td>
      <td>{receipt ? (receipt.skipped ? 'Skipped' : 'Imported') : 'Ready'}</td>
    </tr>
  )
}
