import { ConsoleRefreshButton } from '@/console/console-page-ui'

type ReflectionsGenerateFormProps = {
  periodStart: string
  periodEnd: string
  isSessionForWallet: boolean
  isGenerating: boolean
  isLoading: boolean
  onPeriodStartChange: (value: string) => void
  onPeriodEndChange: (value: string) => void
  onSubmit: (event: React.FormEvent) => void
  onRefresh: () => void
}

export function ReflectionsGenerateForm({
  periodStart,
  periodEnd,
  isSessionForWallet,
  isGenerating,
  isLoading,
  onPeriodStartChange,
  onPeriodEndChange,
  onSubmit,
  onRefresh,
}: ReflectionsGenerateFormProps) {
  return (
    <form className="console-form inline" onSubmit={onSubmit}>
      <label>
        <span>Period start</span>
        <input type="datetime-local" value={periodStart} onChange={(event) => onPeriodStartChange(event.target.value)} />
      </label>
      <label>
        <span>Period end</span>
        <input type="datetime-local" value={periodEnd} onChange={(event) => onPeriodEndChange(event.target.value)} />
      </label>
      <div className="console-actions">
        <button className="primary-action" type="submit" disabled={!isSessionForWallet || isGenerating}>
          {isGenerating ? 'Generating...' : 'Generate weekly reflection'}
        </button>
        <ConsoleRefreshButton
          isLoading={isLoading}
          label="Refresh list"
          onClick={onRefresh}
        />
      </div>
    </form>
  )
}
