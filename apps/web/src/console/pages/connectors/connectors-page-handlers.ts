import { CONNECTOR_PROVIDER_DEFAULTS } from '@/console/pages/connectors/connector-page-constants'
import {
  runConnectSource,
  runSyncConnectorAccount,
} from '@/console/pages/connectors/connector-page-mutations'
import type { Session } from '@/lib/session'

type ConnectorsPageHandlersInput = {
  session: Session | null
  isSessionForWallet: boolean
  provider: string
  displayName: string
  sourceId: string
  sourceName: string
  sourceUri: string
  syncCadence: string
  onSessionRefreshed: (session: Session) => void
  loadConnectors: () => Promise<void>
  setProvider: (value: string) => void
  setDisplayName: (value: string) => void
  setSourceId: (value: string) => void
  setSourceName: (value: string) => void
  setSourceUri: (value: string) => void
  setStatus: (value: string | null) => void
  setIsLoading: (value: boolean) => void
}

export function createConnectorsPageHandlers(input: ConnectorsPageHandlersInput) {
  function selectProvider(value: string) {
    input.setProvider(value)
    const defaults = CONNECTOR_PROVIDER_DEFAULTS[value]
    if (!defaults) {
      return
    }

    input.setDisplayName(defaults.label)
    input.setSourceId(defaults.sourceId)
    input.setSourceName(defaults.sourceName)
    input.setSourceUri(defaults.sourceUri)
  }

  function connectSource() {
    if (!input.session || !input.isSessionForWallet) {
      input.setStatus('Sign in required.')
      return
    }

    void runConnectSource({
      session: input.session,
      provider: input.provider,
      displayName: input.displayName,
      sourceId: input.sourceId,
      sourceName: input.sourceName,
      sourceUri: input.sourceUri,
      syncCadence: input.syncCadence,
      onSessionRefreshed: input.onSessionRefreshed,
      loadConnectors: input.loadConnectors,
      setStatus: input.setStatus,
      setIsLoading: input.setIsLoading,
    })
  }

  function syncAccount(accountId: string, connectorSourceId?: string | null) {
    if (!input.session || !input.isSessionForWallet) {
      input.setStatus('Sign in required.')
      return
    }

    void runSyncConnectorAccount({
      session: input.session,
      accountId,
      connectorSourceId,
      onSessionRefreshed: input.onSessionRefreshed,
      loadConnectors: input.loadConnectors,
      setStatus: input.setStatus,
      setIsLoading: input.setIsLoading,
    })
  }

  return { connectSource, selectProvider, syncAccount }
}
