import { ConsolePage, ConsoleStatus } from '@/console/console-page-ui'
import { ReflectionsGenerateForm } from '@/console/pages/reflections/ReflectionsGenerateForm'
import { ReflectionsRunsTable } from '@/console/pages/reflections/ReflectionsRunsTable'
import { useReflectionsPage } from '@/console/pages/reflections/use-reflections-page'

export function ReflectionsPage() {
  const reflections = useReflectionsPage()

  return (
    <ConsolePage title="Weekly reflection test">
      <ReflectionsGenerateForm
        periodStart={reflections.periodStart}
        periodEnd={reflections.periodEnd}
        isSessionForWallet={reflections.isSessionForWallet}
        isGenerating={reflections.isGenerating}
        isLoading={reflections.isLoading}
        onPeriodStartChange={reflections.setPeriodStart}
        onPeriodEndChange={reflections.setPeriodEnd}
        onSubmit={reflections.handleGenerate}
        onRefresh={() => void reflections.loadRuns()}
      />

      <ConsoleStatus status={reflections.status} />

      <ReflectionsRunsTable
        runs={reflections.runs}
        selectedReflectionId={reflections.selectedReflectionId}
        onSelectRun={reflections.setSelectedReflectionId}
      />
    </ConsolePage>
  )
}
