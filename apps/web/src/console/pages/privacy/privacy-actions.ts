import { errorMessage, getAuthedJson } from '@/lib/api'
import type { Session } from '@/lib/session'
import type { PrivacyCheckResponse } from '@/types/console.types'

export async function fetchPrivacyCheck(input: {
  session: Session
  artifactId: string
  onSessionRefreshed: (session: Session) => void
}) {
  return getAuthedJson<PrivacyCheckResponse>(
    `/v1/twins/${input.session.twinId}/artifacts/${input.artifactId}/privacy-check`,
    input.session,
    input.onSessionRefreshed,
  )
}

export function privacyErrorMessage(error: unknown) {
  return errorMessage(error)
}
