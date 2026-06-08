import { useState } from 'react'
import { useConsoleContext } from '@/console/context'
import type { MemorySearchResult } from '@/types/console.types'
import { errorMessage, postAuthedJson } from '@/lib/api'

export function useRetrievalPage() {
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
      setIsSearching(false)
    } catch (error) {
      setResults([])
      setPolicy(null)
      setStatus(errorMessage(error))
      setIsSearching(false)
    }
  }

  return {
    handleSearch,
    isSearching,
    isSessionForWallet,
    limit,
    policy,
    query,
    results,
    setLimit,
    setQuery,
    status,
  }
}
