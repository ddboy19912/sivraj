import { useState } from 'react'
import { errorMessage, postAuthedJson } from '../../lib/api'
import { useConsoleContext } from '../context'
import type { CodingAgentExportPreset, EngineeringInstructionPatchResponse } from '../types'

export function InstructionPatchPage() {
  const { session, isSessionForWallet, onSessionRefreshed } = useConsoleContext()
  const [projectName, setProjectName] = useState('Sivraj')
  const [repoName, setRepoName] = useState('sivraj')
  const [packageName, setPackageName] = useState('sivraj')
  const [packageManager, setPackageManager] = useState('pnpm')
  const [frameworks, setFrameworks] = useState('vite, react')
  const [preset, setPreset] = useState<CodingAgentExportPreset>('codex')
  const [includeCandidate, setIncludeCandidate] = useState(false)
  const [patch, setPatch] = useState<EngineeringInstructionPatchResponse | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  async function generatePatch() {
    if (!session || !isSessionForWallet) {
      setStatus('Connect wallet and sign in to generate an instruction patch.')
      return
    }

    setIsLoading(true)

    try {
      const response = await postAuthedJson<EngineeringInstructionPatchResponse>(
        `/v1/twins/${session.twinId}/engineering/instruction-patch`,
        {
          projectName,
          repoName,
          packageName,
          packageManager,
          frameworks,
          preset,
          includeCandidate,
        },
        session,
        onSessionRefreshed,
      )
      setPatch(response)
      setStatus(`${response.patch.targetFile} suggestion generated with ${response.patch.itemCount} rule(s).`)
    } catch (error) {
      setPatch(null)
      setStatus(errorMessage(error))
    } finally {
      setIsLoading(false)
    }
  }

  async function copyPatch() {
    if (!patch) {
      return
    }

    try {
      await navigator.clipboard.writeText(patch.patch.content || patch.patch.suggestedMarkdown)
      setStatus(`Copied ${patch.patch.targetFile} suggestion.`)
    } catch {
      setStatus('Copy failed. Select the markdown manually.')
    }
  }

  return (
    <section className="console-page">
      <div className="section-heading">
        <p className="eyebrow">Testing console</p>
        <h2>Instruction patch</h2>
      </div>

      <form className="console-form inline" onSubmit={(event) => {
        event.preventDefault()
        void generatePatch()
      }}>
        <label>
          <span>Export preset</span>
          <select value={preset} onChange={(event) => setPreset(event.target.value as CodingAgentExportPreset)}>
            <option value="codex">Codex / AGENTS.md</option>
            <option value="claude_code">Claude Code / CLAUDE.md</option>
            <option value="cursor">Cursor / .cursor/rules/sivraj.mdc</option>
            <option value="generic_mcp">Generic MCP / sivraj-context.json</option>
          </select>
        </label>
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
        <label className="console-checkbox">
          <input
            type="checkbox"
            checked={includeCandidate}
            onChange={(event) => setIncludeCandidate(event.target.checked)}
          />
          <span>Include candidate rules</span>
        </label>
        <button className="primary-action" type="submit" disabled={isLoading}>
          {isLoading ? 'Generating...' : 'Generate patch'}
        </button>
      </form>

      {status ? <p className="console-status">{status}</p> : null}

      {patch ? (
        <>
          <div className="console-grid">
            <div className="console-panel">
              <h3>Patch summary</h3>
              <dl>
                <dt>Target</dt>
                <dd>{patch.patch.targetFile}</dd>
                <dt>Preset</dt>
                <dd>{patch.patch.preset}</dd>
                <dt>Format</dt>
                <dd>{patch.patch.format}</dd>
                <dt>Operation</dt>
                <dd>{patch.patch.operation}</dd>
                <dt>Rules</dt>
                <dd>{patch.patch.itemCount}</dd>
                <dt>Auto write</dt>
                <dd>{patch.policy.autoWriteEnabled ? 'Enabled' : 'Disabled'}</dd>
              </dl>
            </div>
            <div className="console-panel">
              <h3>Quality</h3>
              <dl>
                <dt>Score</dt>
                <dd>{Math.round(patch.patch.quality.score * 100)}%</dd>
                <dt>Label</dt>
                <dd>{patch.patch.quality.label}</dd>
                <dt>Ready</dt>
                <dd>{patch.patch.quality.readyForAgent ? 'Yes' : 'No'}</dd>
                <dt>Evidence</dt>
                <dd>{patch.patch.evidence.length}</dd>
              </dl>
            </div>
          </div>

          {patch.patch.warnings.length > 0 ? (
            <div className="console-panel wide">
              <h3>Warnings</h3>
              <ul className="console-context-items">
                {patch.patch.warnings.map((warning) => (
                  <li key={warning}>
                    <strong>{warning}</strong>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="console-panel wide">
            <div className="console-panel-header">
              <h3>{patch.patch.targetFile} preview</h3>
              <button className="secondary-action compact" type="button" onClick={() => void copyPatch()}>
                Copy export
              </button>
            </div>
            <pre>{patch.patch.content || patch.patch.suggestedMarkdown}</pre>
          </div>
        </>
      ) : null}
    </section>
  )
}
