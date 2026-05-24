import { useEffect, useState } from 'react'
import { errorMessage, getAuthedJson } from '../../lib/api'
import { useConsoleContext } from '../context'
import type { PrivacyCheckResponse } from '../types'

const CHECK_LABELS: Record<string, string> = {
  sourceArtifactHasRawStorageRef: 'Source artifact has raw_storage_ref',
  sourceArtifactHasCiphertextHash: 'Source artifact has ciphertext hash',
  sourceArtifactMetadataHasNoPlaintextFields: 'No plaintext title/content in artifact metadata',
  memoryFragmentHasContentStorageRef: 'Memory fragment has content_storage_ref',
  candidateMemoriesUseStatementStorageRef: 'Candidate memories use statement_storage_ref',
  completedReflectionsUseSummaryStorageRef: 'Completed reflections use summary_storage_ref',
}

export function PrivacyPage() {
  const { session, isSessionForWallet, onSessionRefreshed, artifactId, setArtifactId } = useConsoleContext()
  const [inputArtifactId, setInputArtifactId] = useState(artifactId)
  const [report, setReport] = useState<PrivacyCheckResponse | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    setInputArtifactId(artifactId)
  }, [artifactId])

  async function loadPrivacyCheck(id = inputArtifactId.trim()) {
    if (!session || !isSessionForWallet) {
      setStatus('Sign in required.')
      return
    }

    if (!id) {
      setStatus('Enter an artifact ID.')
      return
    }

    setIsLoading(true)

    try {
      const response = await getAuthedJson<PrivacyCheckResponse>(
        `/v1/twins/${session.twinId}/artifacts/${id}/privacy-check`,
        session,
        onSessionRefreshed,
      )
      setReport(response)
      setArtifactId(id)
      setStatus(response.allChecksPassed ? 'All privacy checks passed.' : 'One or more privacy checks failed.')
    } catch (error) {
      setReport(null)
      setStatus(errorMessage(error))
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <section className="console-page">
      <div className="section-heading">
        <p className="eyebrow">Testing console</p>
        <h2>Privacy verification</h2>
      </div>

      <div className="console-form inline">
        <label>
          <span>Artifact ID</span>
          <input value={inputArtifactId} onChange={(event) => setInputArtifactId(event.target.value)} />
        </label>
        <div className="console-actions">
          <button className="secondary-action" type="button" disabled={isLoading} onClick={() => void loadPrivacyCheck()}>
            {isLoading ? 'Checking...' : 'Run privacy check'}
          </button>
        </div>
      </div>

      {status ? <p className="console-status">{status}</p> : null}

      {report ? (
        <>
          <ul className="console-checklist">
            {Object.entries(report.checklist).map(([key, passed]) => (
              <li key={key} className={passed ? 'pass' : 'fail'}>
                <span className={passed ? 'dot ok' : 'dot fail'} />
                <span>{CHECK_LABELS[key] ?? key}</span>
                <strong>{passed ? 'PASS' : 'FAIL'}</strong>
              </li>
            ))}
          </ul>

          <div className="console-grid">
            <div className="console-panel">
              <h3>Artifact metadata</h3>
              <pre>{JSON.stringify(report.artifact, null, 2)}</pre>
            </div>
            <div className="console-panel">
              <h3>Memory fragment</h3>
              <pre>{JSON.stringify(report.memoryFragment, null, 2)}</pre>
            </div>
            <div className="console-panel wide">
              <h3>Related encrypted refs</h3>
              <pre>
                {JSON.stringify(
                  {
                    candidateMemories: report.candidateMemories,
                    reflections: report.reflections,
                  },
                  null,
                  2,
                )}
              </pre>
            </div>
          </div>
        </>
      ) : null}
    </section>
  )
}
