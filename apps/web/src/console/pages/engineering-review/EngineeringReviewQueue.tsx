import { EngineeringReviewIssueCard } from '@/console/pages/engineering-review/EngineeringReviewIssueCard'
import { EngineeringReviewSummaryPanels } from '@/console/pages/engineering-review/EngineeringReviewSummaryPanels'
import type { EngineeringReviewQueueResponse } from '@/types/console.types'

type EngineeringReviewQueueProps = {
  queue: EngineeringReviewQueueResponse
  submittingId: string | null
  onSubmitAction: (candidateId: string, action: string) => void
}

export function EngineeringReviewQueue({
  queue,
  submittingId,
  onSubmitAction,
}: EngineeringReviewQueueProps) {
  return (
    <>
      <EngineeringReviewSummaryPanels queue={queue} />

      {queue.issues.length === 0 ? (
        <p className="console-banner success">No stale or conflicting engineering instructions for this repo fingerprint.</p>
      ) : null}

      <div className="console-grid">
        {queue.issues.map((issue) => (
          <EngineeringReviewIssueCard
            key={`${issue.reason}-${issue.candidate?.id ?? 'none'}-${issue.existing?.id ?? 'none'}`}
            issue={issue}
            submittingId={submittingId}
            onSubmitAction={onSubmitAction}
          />
        ))}
      </div>
    </>
  )
}
