import type { ArtifactReceipt } from '@/types/console.types'

export function AiChatImportReviewHeader({
  receipt,
}: {
  receipt: ArtifactReceipt | null
}) {
  return (
    <div className="console-panel-header">
      <h3>AI chat import review</h3>
      {receipt ? (
        <span className={receipt.skipped ? 'console-chip warn' : 'console-chip'}>
          {receipt.skipped ? 'Skipped' : 'Imported'}
        </span>
      ) : null}
    </div>
  )
}
