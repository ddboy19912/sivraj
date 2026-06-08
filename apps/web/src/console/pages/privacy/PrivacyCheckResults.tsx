import type { PrivacyCheckResponse } from '@/types/console.types'

const CHECK_LABELS: Record<string, string> = {
  sourceArtifactHasRawStorageRef: 'Source artifact has raw_storage_ref',
  sourceArtifactHasCiphertextHash: 'Source artifact has ciphertext hash',
  sourceArtifactMetadataHasNoPlaintextFields: 'No plaintext title/content in artifact metadata',
  memoryFragmentHasContentStorageRef: 'Memory fragment has content_storage_ref',
  candidateMemoriesUseStatementStorageRef: 'Candidate memories use statement_storage_ref',
  completedReflectionsUseSummaryStorageRef: 'Completed reflections use summary_storage_ref',
}

type PrivacyCheckResultsProps = {
  report: PrivacyCheckResponse
}

export function PrivacyCheckResults({ report }: PrivacyCheckResultsProps) {
  return (
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
  )
}
