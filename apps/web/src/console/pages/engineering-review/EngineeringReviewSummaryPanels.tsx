import type { EngineeringReviewQueueResponse } from '@/types/console.types'

type EngineeringReviewSummaryPanelsProps = {
  queue: EngineeringReviewQueueResponse
}

export function EngineeringReviewSummaryPanels({ queue }: EngineeringReviewSummaryPanelsProps) {
  return (
    <div className="console-grid">
      <div className="console-panel">
        <h3>Quality impact</h3>
        <dl>
          <dt>Score</dt>
          <dd>{Math.round(queue.summary.quality.score * 100)}%</dd>
          <dt>Label</dt>
          <dd>{queue.summary.quality.label}</dd>
          <dt>Ready</dt>
          <dd>{queue.summary.quality.readyForAgent ? 'Yes' : 'No'}</dd>
        </dl>
      </div>
      <div className="console-panel">
        <h3>Scope</h3>
        <dl>
          <dt>Memories</dt>
          <dd>{queue.summary.totalEngineeringMemories}</dd>
          <dt>Issues</dt>
          <dd>{queue.summary.issueCount}</dd>
          <dt>Repo</dt>
          <dd>
            {[queue.repoFingerprint.repoName, queue.repoFingerprint.packageManager, ...queue.repoFingerprint.frameworks]
              .filter(Boolean)
              .join(' · ') || '—'}
          </dd>
        </dl>
      </div>
    </div>
  )
}
