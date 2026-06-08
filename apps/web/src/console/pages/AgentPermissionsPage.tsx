import { ConsoleInfoPanel, ConsolePage, ConsoleStatus } from '@/console/console-page-ui'
import { AgentPermissionsClientsTable } from '@/console/pages/agent-permissions/AgentPermissionsClientsTable'
import { AgentPermissionsCreateForm } from '@/console/pages/agent-permissions/AgentPermissionsCreateForm'
import { useAgentPermissionsPage } from '@/console/pages/agent-permissions/use-agent-permissions-page'

export function AgentPermissionsPage() {
  const permissions = useAgentPermissionsPage()

  return (
    <ConsolePage title="Agent permissions">
      <ConsoleInfoPanel
        items={[
          {
            term: 'Purpose',
            detail: 'Create and revoke scoped coding-agent access to Sivraj context, retrieval, sources, and writebacks.',
          },
          {
            term: 'Trust boundary',
            detail: 'Tokens are narrow, time-limited, and auditable. Private raw memories are not exported.',
          },
        ]}
      />

      <AgentPermissionsCreateForm
        agentName={permissions.agentName}
        expiresInMinutes={permissions.expiresInMinutes}
        isSubmitting={permissions.isSubmitting}
        isLoading={permissions.isLoading}
        onAgentNameChange={permissions.setAgentName}
        onExpiresInMinutesChange={permissions.setExpiresInMinutes}
        onSubmit={() => void permissions.createAgentToken()}
        onRefresh={() => void permissions.loadClients()}
      />

      <ConsoleStatus status={permissions.status} />

      {permissions.tokenPreview ? (
        <div className="console-panel wide">
          <h3>New bearer token</h3>
          <p className="console-footnote">Use this token in your MCP server env as <code>SIVRAJ_API_TOKEN</code>.</p>
          <pre>{permissions.tokenPreview}</pre>
        </div>
      ) : null}

      <AgentPermissionsClientsTable
        clients={permissions.clients}
        isSubmitting={permissions.isSubmitting}
        onRevokeGrant={(client) => void permissions.revokeGrant(client)}
      />
    </ConsolePage>
  )
}
