import { useState } from 'react'
import { useConsoleSessionEffect } from '@/console/console-page-ui'
import { requireConsoleSession } from '@/console/console-session'
import { createConnectorsPageHandlers } from '@/console/pages/connectors/connectors-page-handlers'
import { fetchConnectorAccounts } from '@/console/pages/connectors/connector-page-mutations'
import { useConsoleContext } from '@/console/context'
import type { ConnectorsResponse } from '@/types/console.types'

export function useConnectorsPage() {
  const { session, isSessionForWallet, onSessionRefreshed } = useConsoleContext()
  const [connectors, setConnectors] = useState<ConnectorsResponse | null>(null)
  const [provider, setProvider] = useState('github')
  const [displayName, setDisplayName] = useState('GitHub repository sync')
  const [sourceId, setSourceId] = useState('github:owner/repo')
  const [sourceName, setSourceName] = useState('owner/repo')
  const [sourceUri, setSourceUri] = useState('https://github.com/owner/repo')
  const [syncCadence, setSyncCadence] = useState('manual')
  const [status, setStatus] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  async function loadConnectors() {
    if (!requireConsoleSession(session, isSessionForWallet, setStatus)) {
      return
    }

    setIsLoading(true)
    try {
      const response = await fetchConnectorAccounts({
        session: session!,
        onSessionRefreshed,
      })
      setConnectors(response)
      setStatus(null)
      setIsLoading(false)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not load connectors.')
      setIsLoading(false)
    }
  }

  const handlers = createConnectorsPageHandlers({
    session,
    isSessionForWallet,
    provider,
    displayName,
    sourceId,
    sourceName,
    sourceUri,
    syncCadence,
    onSessionRefreshed,
    loadConnectors,
    setProvider,
    setDisplayName,
    setSourceId,
    setSourceName,
    setSourceUri,
    setStatus,
    setIsLoading,
  })

  useConsoleSessionEffect(isSessionForWallet, session?.twinId, loadConnectors)

  return {
    connectSource: handlers.connectSource,
    connectors,
    displayName,
    isLoading,
    loadConnectors,
    provider,
    selectProvider: handlers.selectProvider,
    setDisplayName,
    setSourceId,
    setSourceName,
    setSourceUri,
    setSyncCadence,
    sourceId,
    sourceName,
    sourceUri,
    status,
    syncAccount: handlers.syncAccount,
    syncCadence,
  }
}
