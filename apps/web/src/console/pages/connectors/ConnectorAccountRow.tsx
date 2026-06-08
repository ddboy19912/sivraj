import type { ConnectorsResponse } from '@/types/console.types'

type ConnectorAccount = ConnectorsResponse['accounts'][number]

type ConnectorAccountRowProps = {
  account: ConnectorAccount
  isLoading: boolean
  onSyncAccount: (accountId: string, connectorSourceId?: string | null) => void
}

export function ConnectorAccountRow({ account, isLoading, onSyncAccount }: ConnectorAccountRowProps) {
  const source = account.sources[0]
  const run = account.lastSyncRun

  return (
    <tr>
      <td>{account.provider}</td>
      <td>{source?.displayName ?? account.displayName}</td>
      <td>{account.status}</td>
      <td>{account.syncCadence}</td>
      <td>{account.lastSyncAt ? new Date(account.lastSyncAt).toLocaleString() : 'Never'}</td>
      <td>{account.nextSyncAt ? new Date(account.nextSyncAt).toLocaleString() : '—'}</td>
      <td>
        {run
          ? `${run.status}: +${run.addedCount} ~${run.updatedCount} skip ${run.skippedCount} fail ${run.failedCount}`
          : 'No syncs'}
      </td>
      <td>
        <button
          className="secondary-action compact"
          type="button"
          disabled={isLoading}
          onClick={() => onSyncAccount(account.id, source?.id ?? null)}
        >
          Sync
        </button>
      </td>
    </tr>
  )
}
