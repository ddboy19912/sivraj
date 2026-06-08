import { ConsolePage, ConsoleRefreshButton, ConsoleStatus } from '@/console/console-page-ui'
import { CandidateMemoriesTable } from '@/console/pages/candidate-memories/CandidateMemoriesTable'
import { useCandidateMemoriesPage } from '@/console/pages/candidate-memories/use-candidate-memories-page'

export function CandidateMemoriesPage() {
  const page = useCandidateMemoriesPage()

  return (
    <ConsolePage title="Candidate memory review">
      <div className="console-actions">
        <ConsoleRefreshButton
          isLoading={page.isLoading}
          label="Refresh list"
          onClick={() => void page.loadCandidates()}
        />
        {page.artifactId ? (
          <span className="console-chip">Filtered by artifact {page.artifactId}</span>
        ) : null}
      </div>

      <ConsoleStatus status={page.status} />

      <CandidateMemoriesTable
        rows={page.rows}
        selectedCandidateId={page.selectedCandidateId}
        isSubmitting={page.isSubmitting}
        onSelectCandidate={page.setSelectedCandidateId}
        onSubmitFeedback={(candidateId, feedbackType) =>
          void page.submitFeedback(candidateId, feedbackType)
        }
      />
    </ConsolePage>
  )
}
