import { ConsolePage, ConsoleStatus } from '@/console/console-page-ui'
import { RetrievalPolicyPanel } from '@/console/pages/retrieval/RetrievalPolicyPanel'
import { RetrievalResults } from '@/console/pages/retrieval/RetrievalResults'
import { useRetrievalPage } from '@/console/pages/retrieval/use-retrieval-page'

export function RetrievalPage() {
  const retrieval = useRetrievalPage()

  return (
    <ConsolePage title="Retrieval test">
      <form className="console-form" onSubmit={retrieval.handleSearch}>
        <label>
          <span>Query</span>
          <input value={retrieval.query} onChange={(event) => retrieval.setQuery(event.target.value)} />
        </label>
        <label>
          <span>Limit</span>
          <input
            type="number"
            min={1}
            max={20}
            value={retrieval.limit}
            onChange={(event) => retrieval.setLimit(Number.parseInt(event.target.value, 10) || 5)}
          />
        </label>
        <div className="console-actions">
          <button className="primary-action" type="submit" disabled={!retrieval.isSessionForWallet || retrieval.isSearching}>
            {retrieval.isSearching ? 'Searching...' : 'Search memories'}
          </button>
        </div>
      </form>

      <ConsoleStatus status={retrieval.status} />

      {retrieval.policy ? <RetrievalPolicyPanel policy={retrieval.policy} /> : null}

      <RetrievalResults results={retrieval.results} />
    </ConsolePage>
  )
}
