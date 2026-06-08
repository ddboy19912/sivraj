import type { MemorySearchResult } from '@/types/console.types'

type RetrievalPolicyPanelProps = {
  policy: NonNullable<MemorySearchResult['policy']>
}

export function RetrievalPolicyPanel({ policy }: RetrievalPolicyPanelProps) {
  return (
    <section className="console-panel">
      <h3>Retrieval timings</h3>
      <dl className="detail-grid">
        {Object.entries(policy.timing ?? {}).map(([key, value]) => (
          <div key={key}>
            <dt>{key}</dt>
            <dd>{formatMs(value)}</dd>
          </div>
        ))}
        <div>
          <dt>Search mode</dt>
          <dd>{policy.searchMode ?? '—'}</dd>
        </div>
        <div>
          <dt>Searched fragments</dt>
          <dd>{policy.searchedFragmentCount ?? 0}</dd>
        </div>
        <div>
          <dt>Encrypted fragments</dt>
          <dd>{policy.encryptedFragmentCount ?? 0}</dd>
        </div>
        <div>
          <dt>Selected for decrypt</dt>
          <dd>{policy.selectedForDecryptCount ?? 0}</dd>
        </div>
        <div>
          <dt>Decrypted candidates</dt>
          <dd>{policy.decryptedCandidateCount ?? 0}</dd>
        </div>
        <div>
          <dt>Decrypt skipped</dt>
          <dd>{policy.decryptSkippedCount ?? 0}</dd>
        </div>
        <div>
          <dt>Decrypt failures</dt>
          <dd>{policy.privateFragmentsSkipped ?? 0}</dd>
        </div>
        <div>
          <dt>Duplicates hidden</dt>
          <dd>{policy.duplicateResultsHidden ?? 0}</dd>
        </div>
      </dl>
    </section>
  )
}

function formatMs(value: number) {
  if (!Number.isFinite(value)) {
    return '—'
  }

  if (value >= 1000) {
    return `${(value / 1000).toFixed(2)}s`
  }

  return `${Math.round(value)}ms`
}
