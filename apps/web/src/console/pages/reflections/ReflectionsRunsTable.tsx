import { ConsoleTable } from '@/console/console-page-ui'
import type { ReflectionRun } from '@/types/console.types'

type ReflectionsRunsTableProps = {
  runs: ReflectionRun[]
  selectedReflectionId: string | null
  onSelectRun: (id: string) => void
}

export function ReflectionsRunsTable({
  runs,
  selectedReflectionId,
  onSelectRun,
}: ReflectionsRunsTableProps) {
  return (
    <ConsoleTable headers={['ID', 'Status', 'Period', 'Storage ref', 'Hash', 'Metadata']}>
      {runs.map((run) => (
        <tr key={run.id} className={run.id === selectedReflectionId ? 'selected' : undefined}>
          <td>
            <button className="text-action" type="button" onClick={() => onSelectRun(run.id)}>
              {run.id.slice(0, 8)}…
            </button>
          </td>
          <td>{run.status}</td>
          <td>
            {run.periodStart} → {run.periodEnd}
          </td>
          <td>{run.summaryStorageRef ?? '—'}</td>
          <td>{run.summarySha256 ?? '—'}</td>
          <td>
            <code>{JSON.stringify(run.metadata)}</code>
          </td>
        </tr>
      ))}
    </ConsoleTable>
  )
}
