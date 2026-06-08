import type { AgentContextResponse } from '@/types/console.types'

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

type AgentContextResultsProps = {
  context: AgentContextResponse
  onCopyMarkdown: () => void
}

export function AgentContextResults({ context, onCopyMarkdown }: AgentContextResultsProps) {
  return (
    <>
      <div className="console-grid">
        <PolicyPanel context={context} />
        <SummaryPanel context={context} />
      </div>

      <QualityPanel context={context} />
      <IssuesPanel issues={context.contextPacket.issues} />

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
          <button className="secondary-action compact" type="button" onClick={onCopyMarkdown}>
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
  )
}

function PolicyPanel({ context }: { context: AgentContextResponse }) {
  return (
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
  )
}

function SummaryPanel({ context }: { context: AgentContextResponse }) {
  const fingerprint = context.contextPacket.project.repoFingerprint

  return (
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
            fingerprint.repoName,
            fingerprint.packageName,
            fingerprint.packageManager,
            ...fingerprint.frameworks,
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
  )
}

function QualityPanel({ context }: { context: AgentContextResponse }) {
  const quality = context.contextPacket.quality

  return (
    <div className="console-panel wide">
      <h3>Context quality</h3>
      <dl>
        <dt>Score</dt>
        <dd>{Math.round(quality.score * 100)}%</dd>
        <dt>Label</dt>
        <dd>{quality.label}</dd>
        <dt>Ready for agent</dt>
        <dd>{quality.readyForAgent ? 'Yes' : 'No'}</dd>
        <dt>Metrics</dt>
        <dd>{Object.entries(quality.metrics).map(([key, value]) => `${key}: ${value}`).join(' · ')}</dd>
      </dl>
      {quality.risks.length > 0 ? (
        <ul className="console-context-items">
          {quality.risks.map((risk) => (
            <li key={risk}>
              <strong>{risk}</strong>
              <span>Risk</span>
            </li>
          ))}
        </ul>
      ) : null}
      <ul className="console-context-items">
        {quality.recommendations.map((recommendation) => (
          <li key={recommendation}>
            <strong>{recommendation}</strong>
            <span>Recommendation</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function IssuesPanel({ issues }: { issues: AgentContextResponse['contextPacket']['issues'] }) {
  if (issues.length === 0) {
    return null
  }

  return (
    <div className="console-panel wide">
      <h3>Context conflicts</h3>
      <ul className="console-context-items">
        {issues.map((issue) => (
          <li key={`${issue.reason}-${issue.candidateId}-${issue.existingId}`}>
            <strong>{issue.reason}</strong>
            <span>{issue.severity} · {issue.scope}</span>
            <small>Candidate {issue.candidateId?.slice(0, 8) ?? '—'} · Existing {issue.existingId?.slice(0, 8) ?? '—'}</small>
          </li>
        ))}
      </ul>
    </div>
  )
}
