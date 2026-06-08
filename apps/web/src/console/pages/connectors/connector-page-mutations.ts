import type { Session } from '@/lib/session'
import {
  connectConnectorSource,
  loadConnectorAccounts,
  syncConnectorAccount,
} from '@/console/pages/connectors/connector-page-actions'
export async function fetchConnectorAccounts(input: {
  session: Session
  onSessionRefreshed: (session: Session) => void
}) {
  return loadConnectorAccounts(input.session, input.onSessionRefreshed)
}

async function connectConnectorAccount(input: {
  session: Session
  provider: string
  displayName: string
  sourceId: string
  sourceName: string
  sourceUri: string
  syncCadence: string
  onSessionRefreshed: (session: Session) => void
}) {
  return connectConnectorSource(input)
}

async function syncConnectorAccountById(input: {
  session: Session
  accountId: string
  connectorSourceId?: string | null
  onSessionRefreshed: (session: Session) => void
}) {
  return syncConnectorAccount(input)
}

export async function runConnectSource(input: {
  session: Session
  provider: string
  displayName: string
  sourceId: string
  sourceName: string
  sourceUri: string
  syncCadence: string
  onSessionRefreshed: (session: Session) => void
  loadConnectors: () => Promise<void>
  setStatus: (value: string | null) => void
  setIsLoading: (value: boolean) => void
}) {
  input.setIsLoading(true)
  try {
    const response = await connectConnectorAccount({
      session: input.session,
      provider: input.provider,
      displayName: input.displayName,
      sourceId: input.sourceId,
      sourceName: input.sourceName,
      sourceUri: input.sourceUri,
      syncCadence: input.syncCadence,
      onSessionRefreshed: input.onSessionRefreshed,
    })
    input.setStatus(`Connected ${response.account.displayName}.`)
    await input.loadConnectors()
  } catch (error) {
    input.setStatus(error instanceof Error ? error.message : 'Connect failed.')
  } finally {
    input.setIsLoading(false)
  }
}

export async function runSyncConnectorAccount(input: {
  session: Session
  accountId: string
  connectorSourceId?: string | null
  onSessionRefreshed: (session: Session) => void
  loadConnectors: () => Promise<void>
  setStatus: (value: string | null) => void
  setIsLoading: (value: boolean) => void
}) {
  input.setIsLoading(true)
  try {
    const response = await syncConnectorAccountById({
      session: input.session,
      accountId: input.accountId,
      connectorSourceId: input.connectorSourceId,
      onSessionRefreshed: input.onSessionRefreshed,
    })
    input.setStatus(response.warning ? response.warning : `Queued sync ${response.syncRun.id}.`)
    await input.loadConnectors()
  } catch (error) {
    input.setStatus(error instanceof Error ? error.message : 'Sync failed.')
  } finally {
    input.setIsLoading(false)
  }
}
