import { ConsoleRefreshButton } from '@/console/console-page-ui'

type AgentPermissionsCreateFormProps = {
  agentName: string
  expiresInMinutes: number
  isSubmitting: boolean
  isLoading: boolean
  onAgentNameChange: (value: string) => void
  onExpiresInMinutesChange: (value: number) => void
  onSubmit: () => void
  onRefresh: () => void
}

export function AgentPermissionsCreateForm({
  agentName,
  expiresInMinutes,
  isSubmitting,
  isLoading,
  onAgentNameChange,
  onExpiresInMinutesChange,
  onSubmit,
  onRefresh,
}: AgentPermissionsCreateFormProps) {
  return (
    <form
      className="console-form inline"
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit()
      }}
    >
      <label>
        <span>Agent name</span>
        <input value={agentName} onChange={(event) => onAgentNameChange(event.target.value)} />
      </label>
      <label>
        <span>TTL minutes</span>
        <input
          type="number"
          min="15"
          max="43200"
          value={expiresInMinutes}
          onChange={(event) => onExpiresInMinutesChange(Number(event.target.value))}
        />
      </label>
      <button className="primary-action" type="submit" disabled={isSubmitting}>
        {isSubmitting ? 'Creating...' : 'Create agent token'}
      </button>
      <ConsoleRefreshButton
        isLoading={isLoading}
        label="Refresh grants"
        loadingLabel="Refreshing..."
        onClick={onRefresh}
      />
    </form>
  )
}
