import type { MemorySearchResult } from '@/types/console.types'

type RetrievalResultsProps = {
  results: MemorySearchResult['results']
}

export function RetrievalResults({ results }: RetrievalResultsProps) {
  return (
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
  )
}
