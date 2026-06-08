import { useState } from 'react'
import { useConsoleSessionEffect } from '@/console/console-page-ui'
import { requireConsoleSession } from '@/console/console-session'
import { errorMessage, getAuthedJson } from '@/lib/api'
import { useConsoleContext } from '@/console/context'
import type { EngineeringSourcesResponse } from '@/types/console.types'

export function useEngineeringSourcesPage() {
  const { session, isSessionForWallet, onSessionRefreshed, setArtifactId } = useConsoleContext()
  const [response, setResponse] = useState<EngineeringSourcesResponse | null>(null)
  const [expandedArtifactId, setExpandedArtifactId] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  async function loadSources() {
    if (!requireConsoleSession(session, isSessionForWallet, setStatus, 'Connect wallet and sign in to view instruction sources.')) {
      return
    }

    setIsLoading(true)

    try {
      const result = await getAuthedJson<EngineeringSourcesResponse>(
        `/v1/twins/${session.twinId}/engineering/sources`,
        session,
        onSessionRefreshed,
      )
      setResponse(result)
      setStatus(`${result.summary.sourceCount} source(s), ${result.summary.engineeringMemoryCount} engineering memor${result.summary.engineeringMemoryCount === 1 ? 'y' : 'ies'}.`)
      setIsLoading(false)
    } catch (error) {
      setResponse(null)
      setStatus(errorMessage(error))
      setIsLoading(false)
    }
  }

  useConsoleSessionEffect(isSessionForWallet, session?.twinId, loadSources)

  function toggleExpandedArtifact(artifactId: string) {
    setExpandedArtifactId((current) => (current === artifactId ? null : artifactId))
  }

  return {
    expandedArtifactId,
    isLoading,
    loadSources,
    response,
    setArtifactId,
    status,
    toggleExpandedArtifact,
  }
}
