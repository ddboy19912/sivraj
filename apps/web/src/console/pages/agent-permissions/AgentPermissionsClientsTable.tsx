import { ConsoleTable } from '@/console/console-page-ui'
import type { AgentClientRow } from '@/types/console.types'

type AgentPermissionsClientsTableProps = {
  clients: AgentClientRow[]
  isSubmitting: boolean
  onRevokeGrant: (client: AgentClientRow) => void
}

export function AgentPermissionsClientsTable({
  clients,
  isSubmitting,
  onRevokeGrant,
}: AgentPermissionsClientsTableProps) {
  return (
    <ConsoleTable
      headers={['Agent', 'Status', 'Scopes', 'Domains', 'Expires', 'Grant', 'Action']}
    >
      {clients.map((client) => (
        <tr key={client.grantId}>
          <td>{client.name}</td>
          <td>{client.status}</td>
          <td>{client.scopes.join(', ')}</td>
          <td>{client.memoryDomains.join(', ') || '—'}</td>
          <td>{client.expiresAt ?? '—'}</td>
          <td>{client.grantId.slice(0, 8)}…</td>
          <td>
            <button
              className="secondary-action compact"
              type="button"
              disabled={isSubmitting || client.status !== 'active'}
              onClick={() => onRevokeGrant(client)}
            >
              Revoke
            </button>
          </td>
        </tr>
      ))}
    </ConsoleTable>
  )
}
