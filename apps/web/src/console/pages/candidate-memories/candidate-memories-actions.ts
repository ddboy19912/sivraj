import { errorMessage, getAuthedJson, postAuthedJson } from '@/lib/api'
import type { Session } from '@/lib/session'
import type { CandidateMemoryRow } from '@/types/console.types'

export async function fetchCandidateMemories(input: {
  session: Session
  artifactId: string
  onSessionRefreshed: (session: Session) => void
}) {
  const query = input.artifactId ? `?artifactId=${encodeURIComponent(input.artifactId)}` : ''
  const response = await getAuthedJson<{ candidateMemories: CandidateMemoryRow[] }>(
    `/v1/twins/${input.session.twinId}/candidate-memories${query}`,
    input.session,
    input.onSessionRefreshed,
  )

  return response.candidateMemories
}

export async function submitCandidateMemoryFeedback(input: {
  session: Session
  candidateId: string
  feedbackType: string
  onSessionRefreshed: (session: Session) => void
}) {
  await postAuthedJson(
    `/v1/twins/${input.session.twinId}/feedback`,
    {
      targetType: 'candidate_memory',
      targetId: input.candidateId,
      feedbackType: input.feedbackType,
    },
    input.session,
    input.onSessionRefreshed,
  )
}

export function candidateMemoriesErrorMessage(error: unknown) {
  return errorMessage(error)
}
