import {
  ConsolePage,
  ConsoleStatus,
  EngineeringProjectFieldInputs,
} from '@/console/console-page-ui'
import { EngineeringReviewQueue } from '@/console/pages/engineering-review/EngineeringReviewQueue'
import { useEngineeringReviewPage } from '@/console/pages/engineering-review/use-engineering-review-page'

export function EngineeringReviewPage() {
  const review = useEngineeringReviewPage()

  return (
    <ConsolePage title="Instruction review queue">
      <form className="console-form inline" onSubmit={(event) => {
        event.preventDefault()
        void review.loadQueue()
      }}>
        <EngineeringProjectFieldInputs
          values={review.projectFields}
          onChange={review.updateProjectField}
        />
        <button className="primary-action" type="submit" disabled={review.isLoading}>
          {review.isLoading ? 'Loading...' : 'Load review queue'}
        </button>
      </form>

      <ConsoleStatus status={review.status} />

      {review.queue ? (
        <EngineeringReviewQueue
          queue={review.queue}
          submittingId={review.submittingId}
          onSubmitAction={(candidateId, action) => void review.submitAction(candidateId, action)}
        />
      ) : null}
    </ConsolePage>
  )
}
