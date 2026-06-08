import { errorMessage, getAuthedJson, postAuthedJson } from '@/lib/api'
import type { Session } from '@/lib/session'
import type { ReflectionRun } from '@/types/console.types'

export async function fetchReflectionRuns(
  session: Session,
  onSessionRefreshed: (session: Session) => void,
) {
  const response = await getAuthedJson<{ reflections: ReflectionRun[] }>(
    `/v1/twins/${session.twinId}/reflections`,
    session,
    onSessionRefreshed,
  )

  return response.reflections
}

export async function generateWeeklyReflection(input: {
  session: Session
  periodStart: string
  periodEnd: string
  onSessionRefreshed: (session: Session) => void
}) {
  const body: Record<string, unknown> = {}

  if (input.periodStart) {
    body.periodStart = new Date(input.periodStart).toISOString()
  }

  if (input.periodEnd) {
    body.periodEnd = new Date(input.periodEnd).toISOString()
  }

  return postAuthedJson<{
    reflectionRunId: string
    status: string
    jobId?: string
  }>(`/v1/twins/${input.session.twinId}/reflections/weekly`, body, input.session, input.onSessionRefreshed)
}

export function reflectionsErrorMessage(error: unknown) {
  return errorMessage(error)
}
