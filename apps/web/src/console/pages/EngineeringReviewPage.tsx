import { useState } from 'react'
import { errorMessage, getAuthedJson, postAuthedJson } from '../../lib/api'
import { useConsoleContext } from '../context'
import type { EngineeringReviewCandidate, EngineeringReviewQueueResponse } from '../types'

const REVIEW_ACTIONS = [
  { id: 'keep_active', label: 'Keep active' },
  { id: 'supersede', label: 'Supersede' },
  { id: 'reject', label: 'Reject' },
  { id: 'needs_review', label: 'Needs review' },
] as const

export function EngineeringReviewPage() {
  const { session, isSessionForWallet, onSessionRefreshed } = useConsoleContext()
  const [projectName, setProjectName] = useState('Sivraj')
  const [repoName, setRepoName] = useState('sivraj')
  const [packageName, setPackageName] = useState('sivraj')
  const [packageManager, setPackageManager] = useState('pnpm')
  const [frameworks, setFrameworks] = useState('vite, react')
  const [queue, setQueue] = useState<EngineeringReviewQueueResponse | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [submittingId, setSubmittingId] = useState<string | null>(null)

  async function loadQueue() {
    if (!session || !isSessionForWallet) {
      setStatus('Connect wallet and sign in to review engineering instructions.')
      return
    }

    setIsLoading(true)

    try {
      const params = new URLSearchParams({
        projectName,
        repoName,
        packageName,
        packageManager,
        frameworks,
        includeTemporary: 'true',
      })
      const response = await getAuthedJson<EngineeringReviewQueueResponse>(
        `/v1/twins/${session.twinId}/engineering/review-queue?${params.toString()}`,
        session,
        onSessionRefreshed,
      )
      setQueue(response)
      setStatus(`${response.summary.issueCount} instruction issue(s) need review.`)
    } catch (error) {
      setQueue(null)
      setStatus(errorMessage(error))
    } finally {
      setIsLoading(false)
    }
  }

  async function submitAction(candidateId: string, action: string) {
    if (!session || !isSessionForWallet) {
      return
    }

    setSubmittingId(candidateId)

    try {
      await postAuthedJson(
        `/v1/twins/${session.twinId}/engineering/review-queue/${candidateId}/action`,
        { action },
        session,
        onSessionRefreshed,
      )
      setStatus(`Instruction ${candidateId.slice(0, 8)}… marked ${action}.`)
      await loadQueue()
    } catch (error) {
      setStatus(errorMessage(error))
    } finally {
      setSubmittingId(null)
    }
  }

  return (
    <section className="console-page">
      <div className="section-heading">
        <p className="eyebrow">Testing console</p>
        <h2>Instruction review queue</h2>
      </div>

      <form className="console-form inline" onSubmit={(event) => {
        event.preventDefault()
        void loadQueue()
      }}>
        <label>
          <span>Project</span>
          <input value={projectName} onChange={(event) => setProjectName(event.target.value)} />
        </label>
        <label>
          <span>Repo</span>
          <input value={repoName} onChange={(event) => setRepoName(event.target.value)} />
        </label>
        <label>
          <span>Package</span>
          <input value={packageName} onChange={(event) => setPackageName(event.target.value)} />
        </label>
        <label>
          <span>Manager</span>
          <input value={packageManager} onChange={(event) => setPackageManager(event.target.value)} />
        </label>
        <label>
          <span>Frameworks</span>
          <input value={frameworks} onChange={(event) => setFrameworks(event.target.value)} />
        </label>
        <button className="primary-action" type="submit" disabled={isLoading}>
          {isLoading ? 'Loading...' : 'Load review queue'}
        </button>
      </form>

      {status ? <p className="console-status">{status}</p> : null}

      {queue ? (
        <>
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
                <dd>{[queue.repoFingerprint.repoName, queue.repoFingerprint.packageManager, ...queue.repoFingerprint.frameworks].filter(Boolean).join(' · ') || '—'}</dd>
              </dl>
            </div>
          </div>

          {queue.issues.length === 0 ? (
            <p className="console-banner success">No stale or conflicting engineering instructions for this repo fingerprint.</p>
          ) : null}

          <div className="console-grid">
            {queue.issues.map((issue) => {
              const target = issue.candidate ?? issue.existing

              return (
                <div key={`${issue.reason}-${issue.candidate?.id ?? 'none'}-${issue.existing?.id ?? 'none'}`} className="console-panel">
                  <h3>{issue.reason}</h3>
                  <p className="console-footnote">{issue.severity} · {issue.issueType} · {issue.scope}</p>
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
                          onClick={() => void submitAction(target.id, action.id)}
                        >
                          {action.label}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        </>
      ) : null}
    </section>
  )
}

function CandidateBlock({ title, candidate }: { title: string; candidate: EngineeringReviewCandidate | null }) {
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
        {candidate.id.slice(0, 8)}… · {candidate.engineeringMemoryType} · {candidate.scope} · {candidate.status}
      </p>
      <p className="console-footnote">Evidence {candidate.evidenceHash.slice(0, 12)}…</p>
    </div>
  )
}
