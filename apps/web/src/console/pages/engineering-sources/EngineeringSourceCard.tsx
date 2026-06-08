import { ConsoleTable } from '@/console/console-page-ui'
import type { EngineeringSourcesResponse } from '@/types/console.types'

type EngineeringSource = EngineeringSourcesResponse['sources'][number]

type EngineeringSourceCardProps = {
  source: EngineeringSource
  isExpanded: boolean
  onToggleExpanded: () => void
  onUseAsArtifactFilter: () => void
}

export function EngineeringSourceCard({
  source,
  isExpanded,
  onToggleExpanded,
  onUseAsArtifactFilter,
}: EngineeringSourceCardProps) {
  return (
    <article className="console-result-card">
      <header>
        <strong>{source.displayName}</strong>
        <span>
          {source.sourceType} · {source.ingestionStatus} · intelligence{' '}
          {source.intelligenceStatus ?? '—'}
        </span>
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
        <button className="secondary-action compact" type="button" onClick={onToggleExpanded}>
          {isExpanded ? 'Hide extracted memories' : 'Show extracted memories'}
        </button>
        <button className="secondary-action compact" type="button" onClick={onUseAsArtifactFilter}>
          Use as artifact filter
        </button>
      </div>

      {isExpanded ? (
        <ConsoleTable headers={['Context', 'Type', 'Scope', 'Status', 'Evidence']}>
          {source.candidates.map((candidate) => (
            <tr key={candidate.id}>
              <td>{candidate.agentContextLine ?? candidate.subject ?? candidate.engineeringMemoryType}</td>
              <td>{candidate.engineeringMemoryType}</td>
              <td>{candidate.scope}</td>
              <td>{candidate.status}</td>
              <td>{candidate.id.slice(0, 8)}…</td>
            </tr>
          ))}
        </ConsoleTable>
      ) : null}
    </article>
  )
}
