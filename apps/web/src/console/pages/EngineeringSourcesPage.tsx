import { useEffect, useState } from 'react'
import { errorMessage, getAuthedJson } from '../../lib/api'
import { useConsoleContext } from '../context'
import type { EngineeringSourcesResponse } from '../types'

export function EngineeringSourcesPage() {
  const { session, isSessionForWallet, onSessionRefreshed, setArtifactId } = useConsoleContext()
  const [response, setResponse] = useState<EngineeringSourcesResponse | null>(null)
  const [expandedArtifactId, setExpandedArtifactId] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  async function loadSources() {
    if (!session || !isSessionForWallet) {
      setStatus('Connect wallet and sign in to view instruction sources.')
      return
    }

    setIsLoading(true)

    try {
      const result = await getAuthedJson<EngineeringSourcesResponse>(
        `/v1/twins/${session.twinId}/engineering/sources`,
        session,
        onSessionRefreshed,
      )
      setResponse(result)
      setStatus(`${result.summary.sourceCount} source(s), ${result.summary.engineeringMemoryCount} engineering memor${result.summary.engineeringMemoryCount === 1 ? 'y' : 'ies'}.`)
    } catch (error) {
      setResponse(null)
      setStatus(errorMessage(error))
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    if (isSessionForWallet) {
      void loadSources()
    }
  }, [isSessionForWallet, session?.twinId])

  return (
    <section className="console-page">
      <div className="section-heading">
        <p className="eyebrow">Testing console</p>
        <h2>Instruction sources</h2>
      </div>

      <div className="console-panel">
        <dl>
          <dt>Purpose</dt>
          <dd>Shows the files and artifacts Sivraj used to learn engineering rules for coding agents.</dd>
          <dt>Privacy</dt>
          <dd>Raw file bodies are not shown. Only source metadata, derived context lines, encrypted refs, and evidence IDs are displayed.</dd>
        </dl>
      </div>

      <div className="console-actions">
        <button className="secondary-action" type="button" disabled={isLoading} onClick={() => void loadSources()}>
          {isLoading ? 'Loading...' : 'Refresh sources'}
        </button>
      </div>

      {status ? <p className="console-status">{status}</p> : null}

      {response?.sources.length === 0 ? (
        <p className="console-banner warn">
          No engineering instruction sources found yet. Upload AGENTS.md, CLAUDE.md, Cursor rules, architecture docs, or coding preference notes, then wait for intelligence to complete.
        </p>
      ) : null}

      <div className="console-results">
        {response?.sources.map((source) => {
          const isExpanded = expandedArtifactId === source.artifactId

          return (
            <article key={source.artifactId} className="console-result-card">
              <header>
                <strong>{source.displayName}</strong>
                <span>{source.sourceType} · {source.ingestionStatus} · intelligence {source.intelligenceStatus ?? '—'}</span>
              </header>

              <dl className="console-mini-dl">
                <dt>Artifact</dt>
                <dd>{source.artifactId}</dd>
                <dt>Uploaded</dt>
                <dd>{source.uploadedAt}</dd>
                <dt>Extracted</dt>
                <dd>{source.extractedEngineeringMemoryCount}</dd>
                <dt>Storage</dt>
                <dd>{source.rawStorageRef ? `${source.rawStorageRef.slice(0, 32)}…` : '—'}</dd>
              </dl>

              <div className="console-actions">
                <button
                  className="secondary-action compact"
                  type="button"
                  onClick={() => setExpandedArtifactId(isExpanded ? null : source.artifactId)}
                >
                  {isExpanded ? 'Hide extracted memories' : 'Show extracted memories'}
                </button>
                <button
                  className="secondary-action compact"
                  type="button"
                  onClick={() => setArtifactId(source.artifactId)}
                >
                  Use as artifact filter
                </button>
              </div>

              {isExpanded ? (
                <div className="console-table-wrap">
                  <table className="console-table">
                    <thead>
                      <tr>
                        <th>Context</th>
                        <th>Type</th>
                        <th>Scope</th>
                        <th>Status</th>
                        <th>Evidence</th>
                      </tr>
                    </thead>
                    <tbody>
                      {source.candidates.map((candidate) => (
                        <tr key={candidate.id}>
                          <td>{candidate.agentContextLine ?? candidate.subject ?? candidate.engineeringMemoryType}</td>
                          <td>{candidate.engineeringMemoryType}</td>
                          <td>{candidate.scope}</td>
                          <td>{candidate.status}</td>
                          <td>{candidate.id.slice(0, 8)}…</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </article>
          )
        })}
      </div>
    </section>
  )
}
