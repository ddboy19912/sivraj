import { ConsoleTable } from '@/console/console-page-ui'
import type { CandidateMemoryRow } from '@/types/console.types'

const FEEDBACK_TYPES = ['approved', 'rejected', 'useful', 'wrong', 'not_me'] as const

export function CandidateMemoriesTable({
  rows,
  selectedCandidateId,
  isSubmitting,
  onSelectCandidate,
  onSubmitFeedback,
}: {
  rows: CandidateMemoryRow[]
  selectedCandidateId: string
  isSubmitting: boolean
  onSelectCandidate: (candidateId: string) => void
  onSubmitFeedback: (candidateId: string, feedbackType: string) => void
}) {
  return (
    <ConsoleTable
      headers={[
        'ID',
        'Canonical',
        'Type',
        'Status',
        'Subject',
        'Confidence',
        'Storage ref',
        'Artifact',
        'Actions',
      ]}
    >
      {rows.map((row) => (
        <tr key={row.id} className={row.id === selectedCandidateId ? 'selected' : undefined}>
          <td>
            <button className="text-action" type="button" onClick={() => onSelectCandidate(row.id)}>
              {row.id.slice(0, 8)}…
            </button>
          </td>
          <td>{row.canonicalMemoryId ? `${row.canonicalMemoryId.slice(0, 8)}…` : '—'}</td>
          <td>{row.memoryType}</td>
          <td>{row.status}</td>
          <td>{row.subject ?? '—'}</td>
          <td>{row.confidenceScore ?? '—'}</td>
          <td>{row.statementStorageRef.slice(0, 18)}…</td>
          <td>{row.sourceArtifactId.slice(0, 8)}…</td>
          <td className="console-row-actions">
            {FEEDBACK_TYPES.map((feedbackType) => (
              <button
                key={feedbackType}
                className="secondary-action compact"
                type="button"
                disabled={isSubmitting}
                onClick={() => onSubmitFeedback(row.id, feedbackType)}
              >
                {feedbackType}
              </button>
            ))}
          </td>
        </tr>
      ))}
    </ConsoleTable>
  )
}
