import { useState } from 'react'
import { errorMessage, getAuthedJson } from '../../lib/api'
import { useConsoleContext } from '../context'
import type { AgentContextResponse, CodingAgentExportPreset } from '../types'

const SECTION_LABELS: Record<string, string> = {
  agentInstructions: 'Agent instructions',
  userPreferences: 'User coding preferences',
  projectConventions: 'Project conventions',
  architectureRules: 'Architecture decisions',
  styleRules: 'Style rules',
  testingPractices: 'Testing practices',
  deploymentEnvironment: 'Deployment environment',
  securityBoundaries: 'Security boundaries',
  knownPitfalls: 'Known pitfalls',
}

export function AgentContextPage() {
  const { session, isSessionForWallet, onSessionRefreshed, artifactId } = useConsoleContext()
  const [projectName, setProjectName] = useState('Sivraj')
  const [repoName, setRepoName] = useState('sivraj')
  const [packageName, setPackageName] = useState('sivraj')
  const [packageManager, setPackageManager] = useState('pnpm')
  const [frameworks, setFrameworks] = useState('vite, react')
  const [gitRemote, setGitRemote] = useState('')
  const [preset, setPreset] = useState<CodingAgentExportPreset>('codex')
  const [includeCandidate, setIncludeCandidate] = useState(true)
  const [context, setContext] = useState<AgentContextResponse | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  async function loadContext() {
    if (!session || !isSessionForWallet) {
      setStatus('Connect wallet and sign in to fetch agent context.')
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
        preset,
        includeCandidate: String(includeCandidate),
      })

      if (gitRemote.trim()) {
        params.set('gitRemote', gitRemote)
      }

      if (artifactId) {
        params.set('artifactId', artifactId)
      }

      const response = await getAuthedJson<AgentContextResponse>(
        `/v1/twins/${session.twinId}/engineering/context?${params.toString()}`,
        session,
        onSessionRefreshed,
      )
      setContext(response)
      setStatus(`${response.profileSummary.includedContextItems} context item(s) ready for coding agents.`)
    } catch (error) {
      setContext(null)
      setStatus(errorMessage(error))
    } finally {
      setIsLoading(false)
    }
  }

  async function copyMarkdown() {
    if (!context?.contextExport?.content) {
      return
    }

    try {
      await navigator.clipboard.writeText(context.contextExport.content)
      setStatus(`Copied ${context.contextExport.targetFile} context export.`)
    } catch {
      setStatus('Copy failed. Select the context export manually.')
    }
  }

  return (
    <section className="console-page">
      <div className="section-heading">
        <p className="eyebrow">Testing console</p>
        <h2>Agent context export</h2>
      </div>

      <div className="console-panel">
        <dl>
          <dt>Relationship</dt>
          <dd>Sivraj remembers and exports context. Coding agents execute code tasks using that context.</dd>
          <dt>Current twin</dt>
          <dd>{session?.twinId ?? '—'}</dd>
          <dt>Artifact filter</dt>
          <dd>{artifactId || 'All engineering memories'}</dd>
        </dl>
      </div>

      <form className="console-form inline" onSubmit={(event) => {
        event.preventDefault()
        void loadContext()
      }}>
        <label>
          <span>Project name</span>
          <input
            value={projectName}
            onChange={(event) => setProjectName(event.target.value)}
            placeholder="Sivraj"
          />
        </label>
        <label>
          <span>Repo name</span>
          <input
            value={repoName}
            onChange={(event) => setRepoName(event.target.value)}
            placeholder="sivraj"
          />
        </label>
        <label>
          <span>Package name</span>
          <input
            value={packageName}
            onChange={(event) => setPackageName(event.target.value)}
            placeholder="sivraj"
          />
        </label>
        <label>
          <span>Package manager</span>
          <input
            value={packageManager}
            onChange={(event) => setPackageManager(event.target.value)}
            placeholder="pnpm"
          />
        </label>
        <label>
          <span>Frameworks</span>
          <input
            value={frameworks}
            onChange={(event) => setFrameworks(event.target.value)}
            placeholder="vite, react"
          />
        </label>
        <label>
          <span>Git remote</span>
          <input
            value={gitRemote}
            onChange={(event) => setGitRemote(event.target.value)}
            placeholder="https://github.com/org/repo"
          />
        </label>
        <label>
          <span>Export preset</span>
          <select value={preset} onChange={(event) => setPreset(event.target.value as CodingAgentExportPreset)}>
            <option value="codex">Codex / AGENTS.md</option>
            <option value="claude_code">Claude Code / CLAUDE.md</option>
            <option value="cursor">Cursor / .cursor/rules</option>
            <option value="generic_mcp">Generic MCP / JSON</option>
          </select>
        </label>
        <label className="console-checkbox">
          <input
            type="checkbox"
            checked={includeCandidate}
            onChange={(event) => setIncludeCandidate(event.target.checked)}
          />
          <span>Include candidate memories</span>
        </label>
        <button className="primary-action" type="submit" disabled={isLoading}>
          {isLoading ? 'Fetching...' : 'Fetch agent context'}
        </button>
      </form>

      {status ? <p className="console-status">{status}</p> : null}

      {context ? (
        <>
          <div className="console-grid">
            <div className="console-panel">
              <h3>Policy</h3>
              <dl>
                <dt>Raw artifacts</dt>
                <dd>{String(context.policy.rawArtifactsIncluded)}</dd>
                <dt>Decrypted memory</dt>
                <dd>{String(context.policy.decryptedMemoryIncluded)}</dd>
                <dt>Plaintext statements</dt>
                <dd>{String(context.policy.plaintextStatementsIncluded)}</dd>
                <dt>Derived context</dt>
                <dd>{String(context.policy.derivedEngineeringContextIncluded ?? true)}</dd>
                <dt>Scope</dt>
                <dd>{context.policy.scope}</dd>
              </dl>
            </div>

            <div className="console-panel">
              <h3>Summary</h3>
              <dl>
                <dt>Engineering memories</dt>
                <dd>{context.profileSummary.totalEngineeringMemories}</dd>
                <dt>Exported items</dt>
                <dd>{context.profileSummary.includedContextItems}</dd>
                <dt>Evidence refs</dt>
                <dd>{context.profileSummary.evidenceRefs}</dd>
                <dt>Warnings</dt>
                <dd>{context.profileSummary.warnings.length || '—'}</dd>
                <dt>Context issues</dt>
                <dd>{context.contextPacket.issues.length || '—'}</dd>
                <dt>Repo fingerprint</dt>
                <dd>
                  {[
                    context.contextPacket.project.repoFingerprint.repoName,
                    context.contextPacket.project.repoFingerprint.packageName,
                    context.contextPacket.project.repoFingerprint.packageManager,
                    ...context.contextPacket.project.repoFingerprint.frameworks,
                  ].filter(Boolean).join(' · ') || '—'}
                </dd>
                <dt>Quality</dt>
                <dd>
                  {Math.round(context.contextPacket.quality.score * 100)}% · {context.contextPacket.quality.label} · {context.contextPacket.quality.readyForAgent ? 'ready' : 'review first'}
                </dd>
                <dt>Export preset</dt>
                <dd>{context.contextExport.preset} · {context.contextExport.format} · {context.contextExport.targetFile}</dd>
              </dl>
            </div>
          </div>

          <div className="console-panel wide">
            <h3>Context quality</h3>
            <dl>
              <dt>Score</dt>
              <dd>{Math.round(context.contextPacket.quality.score * 100)}%</dd>
              <dt>Label</dt>
              <dd>{context.contextPacket.quality.label}</dd>
              <dt>Ready for agent</dt>
              <dd>{context.contextPacket.quality.readyForAgent ? 'Yes' : 'No'}</dd>
              <dt>Metrics</dt>
              <dd>{Object.entries(context.contextPacket.quality.metrics).map(([key, value]) => `${key}: ${value}`).join(' · ')}</dd>
            </dl>
            {context.contextPacket.quality.risks.length > 0 ? (
              <ul className="console-context-items">
                {context.contextPacket.quality.risks.map((risk) => (
                  <li key={risk}>
                    <strong>{risk}</strong>
                    <span>Risk</span>
                  </li>
                ))}
              </ul>
            ) : null}
            <ul className="console-context-items">
              {context.contextPacket.quality.recommendations.map((recommendation) => (
                <li key={recommendation}>
                  <strong>{recommendation}</strong>
                  <span>Recommendation</span>
                </li>
              ))}
            </ul>
          </div>

          {context.contextPacket.issues.length > 0 ? (
            <div className="console-panel wide">
              <h3>Context conflicts</h3>
              <ul className="console-context-items">
                {context.contextPacket.issues.map((issue) => (
                  <li key={`${issue.reason}-${issue.candidateId}-${issue.existingId}`}>
                    <strong>{issue.reason}</strong>
                    <span>{issue.severity} · {issue.scope}</span>
                    <small>Candidate {issue.candidateId?.slice(0, 8) ?? '—'} · Existing {issue.existingId?.slice(0, 8) ?? '—'}</small>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {context.profileSummary.includedContextItems === 0 ? (
            <p className="console-banner warn">
              No engineering context was exported. Upload AGENTS.md, CLAUDE.md, architecture docs, or coding preference notes, then wait for intelligence to complete.
            </p>
          ) : null}

          <div className="console-grid">
            {Object.entries(context.contextPacket.sections).map(([sectionKey, items]) => (
              <div key={sectionKey} className="console-panel">
                <h3>{SECTION_LABELS[sectionKey] ?? sectionKey}</h3>
                {items.length === 0 ? (
                  <p className="console-footnote">No context exported.</p>
                ) : (
                  <ul className="console-context-items">
                    {items.map((item) => (
                      <li key={item.id}>
                        <strong>{item.agentContextLine || item.subject || item.type}</strong>
                        <span>{item.type} · {item.scope} · {item.status} · {item.confidence.toFixed(2)}</span>
                        <small>Evidence {item.evidence.candidateMemoryId.slice(0, 8)}…</small>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>

          <div className="console-panel wide">
            <div className="console-panel-header">
              <h3>Copy for {context.contextExport.targetFile}</h3>
              <button className="secondary-action compact" type="button" onClick={() => void copyMarkdown()}>
                Copy export
              </button>
            </div>
            <pre>{context.contextExport.content}</pre>
          </div>

          <div className="console-panel wide">
            <h3>Raw JSON</h3>
            <pre>{JSON.stringify(context.contextPacket, null, 2)}</pre>
          </div>
        </>
      ) : null}
    </section>
  )
}
