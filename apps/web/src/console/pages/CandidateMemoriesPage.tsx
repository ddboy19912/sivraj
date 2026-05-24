import { useEffect, useState } from 'react'
import { errorMessage, getAuthedJson, postAuthedJson } from '../../lib/api'
import { useConsoleContext } from '../context'
import type { CandidateMemoryRow } from '../types'

export function CandidateMemoriesPage() {
  const {
    session,
    isSessionForWallet,
    onSessionRefreshed,
    artifactId,
    selectedCandidateId,
    setSelectedCandidateId,
  } = useConsoleContext()
  const [rows, setRows] = useState<CandidateMemoryRow[]>([])
  const [status, setStatus] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function loadCandidates() {
    if (!session || !isSessionForWallet) {
      setStatus('Sign in required.')
      return
    }

    setIsLoading(true)

    try {
      const query = artifactId ? `?artifactId=${encodeURIComponent(artifactId)}` : ''
      const response = await getAuthedJson<{ candidateMemories: CandidateMemoryRow[] }>(
        `/v1/twins/${session.twinId}/candidate-memories${query}`,
        session,
        onSessionRefreshed,
      )
      setRows(response.candidateMemories)
      setStatus(`${response.candidateMemories.length} candidate memory row(s).`)
    } catch (error) {
      setRows([])
      setStatus(errorMessage(error))
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    if (isSessionForWallet) {
      void loadCandidates()
    }
  }, [artifactId, isSessionForWallet, session?.twinId])

  async function submitFeedback(candidateId: string, feedbackType: string) {
    if (!session || !isSessionForWallet) {
      return
    }

    setIsSubmitting(true)

    try {
      await postAuthedJson(
        `/v1/twins/${session.twinId}/feedback`,
        {
          targetType: 'candidate_memory',
          targetId: candidateId,
          feedbackType,
        },
        session,
        onSessionRefreshed,
      )
      setStatus(`Feedback "${feedbackType}" recorded for ${candidateId}.`)
      await loadCandidates()
    } catch (error) {
      setStatus(errorMessage(error))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <section className="console-page">
      <div className="section-heading">
        <p className="eyebrow">Testing console</p>
        <h2>Candidate memory review</h2>
      </div>

      <div className="console-actions">
        <button className="secondary-action" type="button" disabled={isLoading} onClick={() => void loadCandidates()}>
          {isLoading ? 'Loading...' : 'Refresh list'}
        </button>
        {artifactId ? <span className="console-chip">Filtered by artifact {artifactId}</span> : null}
      </div>

      {status ? <p className="console-status">{status}</p> : null}

      <div className="console-table-wrap">
        <table className="console-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Canonical</th>
              <th>Type</th>
              <th>Status</th>
              <th>Subject</th>
              <th>Confidence</th>
              <th>Storage ref</th>
              <th>Artifact</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className={row.id === selectedCandidateId ? 'selected' : undefined}>
                <td>
                  <button className="text-action" type="button" onClick={() => setSelectedCandidateId(row.id)}>
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
                  {['approved', 'rejected', 'useful', 'wrong', 'not_me'].map((feedbackType) => (
                    <button
                      key={feedbackType}
                      className="secondary-action compact"
                      type="button"
                      disabled={isSubmitting}
                      onClick={() => void submitFeedback(row.id, feedbackType)}
                    >
                      {feedbackType}
                    </button>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
