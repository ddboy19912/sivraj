import { ConsoleTable } from '@/console/console-page-ui'
import { ConnectorAccountRow } from '@/console/pages/connectors/ConnectorAccountRow'
import type { ConnectorsResponse } from '@/types/console.types'

type ConnectorsAccountsTableProps = {
  connectors: ConnectorsResponse | null
  isLoading: boolean
  onSyncAccount: (accountId: string, connectorSourceId?: string | null) => void
}

export function ConnectorsAccountsTable({
  connectors,
  isLoading,
  onSyncAccount,
}: ConnectorsAccountsTableProps) {
  if (!connectors?.accounts.length) {
    return <p>No connectors linked yet.</p>
  }

  return (
    <ConsoleTable
      headers={[
        'Provider',
        'Name',
        'Status',
        'Cadence',
        'Last sync',
        'Next sync',
        'Last result',
        'Action',
      ]}
    >
      {connectors.accounts.map((account) => (
        <ConnectorAccountRow
          key={account.id}
          account={account}
          isLoading={isLoading}
          onSyncAccount={onSyncAccount}
        />
      ))}
    </ConsoleTable>
  )
}
