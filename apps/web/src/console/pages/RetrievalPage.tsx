import { useState } from 'react'
import { errorMessage, postAuthedJson } from '../../lib/api'
import { useConsoleContext } from '../context'
import type { MemorySearchResult } from '../types'

export function RetrievalPage() {
  const { session, isSessionForWallet, onSessionRefreshed } = useConsoleContext()
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(5)
  const [results, setResults] = useState<MemorySearchResult['results']>([])
  const [policy, setPolicy] = useState<MemorySearchResult['policy'] | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [isSearching, setIsSearching] = useState(false)

  async function handleSearch(event: React.FormEvent) {
    event.preventDefault()

    if (!session || !isSessionForWallet) {
      setStatus('Sign in required.')
      return
    }

    if (!query.trim()) {
      setStatus('Enter a query.')
      return
    }

    setIsSearching(true)
    setStatus('Searching memories...')

    try {
      const response = await postAuthedJson<MemorySearchResult>(
        `/v1/twins/${session.twinId}/memories/search`,
        {
          query: query.trim(),
          limit,
        },
        session,
        onSessionRefreshed,
      )
      setResults(response.results)
      setPolicy(response.policy ?? null)
      setStatus(`${response.results.length} result(s).`)
    } catch (error) {
      setResults([])
      setPolicy(null)
      setStatus(errorMessage(error))
    } finally {
      setIsSearching(false)
    }
  }

  return (
    <section className="console-page">
      <div className="section-heading">
        <p className="eyebrow">Testing console</p>
        <h2>Retrieval test</h2>
      </div>

      <form className="console-form" onSubmit={handleSearch}>
        <label>
          <span>Query</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
        <label>
          <span>Limit</span>
          <input
            type="number"
            min={1}
            max={20}
            value={limit}
            onChange={(event) => setLimit(Number.parseInt(event.target.value, 10) || 5)}
          />
        </label>
        <div className="console-actions">
          <button className="primary-action" type="submit" disabled={!isSessionForWallet || isSearching}>
            {isSearching ? 'Searching...' : 'Search memories'}
          </button>
        </div>
      </form>

      {status ? <p className="console-status">{status}</p> : null}

      {policy ? (
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
      ) : null}

      <div className="console-results">
        {results.map((result) => (
          <article key={result.id} className="console-result-card">
            <header>
              <strong>Score {result.score.toFixed(3)}</strong>
              <span>{result.sourceArtifactId}</span>
            </header>
            <p>{result.content}</p>
            <footer>
              Fragment {result.id} · Matched terms:{' '}
              {result.matchedTerms.length > 0 ? result.matchedTerms.join(', ') : '—'}
              {result.canonicalMemoryId ? ` · Canonical ${result.canonicalMemoryId}` : ''}
            </footer>
          </article>
        ))}
      </div>
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
