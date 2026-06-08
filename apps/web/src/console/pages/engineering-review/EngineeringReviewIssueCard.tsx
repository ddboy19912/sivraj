import type { EngineeringReviewCandidate } from '@/types/console.types'

const REVIEW_ACTIONS = [
  { id: 'keep_active', label: 'Keep active' },
  { id: 'supersede', label: 'Supersede' },
  { id: 'reject', label: 'Reject' },
  { id: 'needs_review', label: 'Needs review' },
] as const

type EngineeringReviewIssue = {
  reason: string
  severity: string
  issueType: string
  scope: string
  candidate: EngineeringReviewCandidate | null
  existing: EngineeringReviewCandidate | null
}

type EngineeringReviewIssueCardProps = {
  issue: EngineeringReviewIssue
  submittingId: string | null
  onSubmitAction: (candidateId: string, action: string) => void
}

export function EngineeringReviewIssueCard({
  issue,
  submittingId,
  onSubmitAction,
}: EngineeringReviewIssueCardProps) {
  const target = issue.candidate ?? issue.existing

  return (
    <div className="console-panel">
      <h3>{issue.reason}</h3>
      <p className="console-footnote">
        {issue.severity} · {issue.issueType} · {issue.scope}
      </p>
      <CandidateBlock title="Candidate" candidate={issue.candidate} />
      <CandidateBlock title="Existing" candidate={issue.existing} />
      {target ? (
        <div className="console-row-actions">
          {REVIEW_ACTIONS.map((action) => (
            <button
              key={action.id}
              className="secondary-action compact"
              type="button"
              disabled={submittingId === target.id}
              onClick={() => onSubmitAction(target.id, action.id)}
            >
              {action.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function CandidateBlock({
  title,
  candidate,
}: {
  title: string
  candidate: EngineeringReviewCandidate | null
}) {
  if (!candidate) {
    return (
      <div className="console-subpanel">
        <strong>{title}</strong>
        <p className="console-footnote">No candidate attached.</p>
      </div>
    )
  }

  return (
    <div className="console-subpanel">
      <strong>{title}</strong>
      <p>{candidate.agentContextLine || candidate.subject || candidate.engineeringMemoryType}</p>
      <p className="console-footnote">
        {candidate.id.slice(0, 8)}… · {candidate.engineeringMemoryType} · {candidate.scope} ·{' '}
        {candidate.status}
      </p>
      <p className="console-footnote">Evidence {candidate.evidenceHash.slice(0, 12)}…</p>
    </div>
  )
}
