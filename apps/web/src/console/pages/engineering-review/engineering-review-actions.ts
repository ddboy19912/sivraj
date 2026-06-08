import { errorMessage, getAuthedJson, postAuthedJson } from '@/lib/api'
import type { EngineeringProjectFields } from '@/types/console.types'
import type { EngineeringReviewQueueResponse } from '@/types/console.types'
import type { Session } from '@/lib/session'

export async function fetchEngineeringReviewQueue(input: {
  session: Session
  onSessionRefreshed: (session: Session) => void
  projectFields: EngineeringProjectFields
}) {
  const params = new URLSearchParams({
    ...input.projectFields,
    includeTemporary: 'true',
  })

  return getAuthedJson<EngineeringReviewQueueResponse>(
    `/v1/twins/${input.session.twinId}/engineering/review-queue?${params.toString()}`,
    input.session,
    input.onSessionRefreshed,
  )
}

export async function submitEngineeringReviewAction(input: {
  session: Session
  candidateId: string
  action: string
  onSessionRefreshed: (session: Session) => void
}) {
  await postAuthedJson(
    `/v1/twins/${input.session.twinId}/engineering/review-queue/${input.candidateId}/action`,
    { action: input.action },
    input.session,
    input.onSessionRefreshed,
  )
}

export function engineeringReviewErrorMessage(error: unknown) {
  return errorMessage(error)
}
