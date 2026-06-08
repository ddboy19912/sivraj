import { ConsoleRefreshButton } from '@/console/console-page-ui'

type AgentWritebacksToolbarProps = {
  statusFilter: string
  isLoading: boolean
  onStatusFilterChange: (value: string) => void
  onRefresh: () => void
}

export function AgentWritebacksToolbar({
  statusFilter,
  isLoading,
  onStatusFilterChange,
  onRefresh,
}: AgentWritebacksToolbarProps) {
  return (
    <div className="console-actions">
      <label className="console-inline-label">
        <span>Status</span>
        <select value={statusFilter} onChange={(event) => onStatusFilterChange(event.target.value)}>
          <option value="">all</option>
          <option value="pending">pending</option>
          <option value="approved">approved</option>
          <option value="rejected">rejected</option>
        </select>
      </label>
      <ConsoleRefreshButton
        isLoading={isLoading}
        label="Refresh writebacks"
        onClick={onRefresh}
      />
    </div>
  )
}
