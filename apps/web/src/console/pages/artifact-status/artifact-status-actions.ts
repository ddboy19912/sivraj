import { errorMessage, getAuthedJson, postAuthedJson } from '@/lib/api'
import type { Session } from '@/lib/session'
import type { ArtifactDetail } from '@/types/console.types'

export async function loadArtifactDetail(input: {
  session: Session
  artifactId: string
  onSessionRefreshed: (session: Session) => void
}) {
  const response = await getAuthedJson<{ artifact: ArtifactDetail }>(
    `/v1/twins/${input.session.twinId}/artifacts/${input.artifactId}`,
    input.session,
    input.onSessionRefreshed,
  )

  return response.artifact
}

export async function retryArtifactProcessing(input: {
  session: Session
  artifactId: string
  onSessionRefreshed: (session: Session) => void
}) {
  await postAuthedJson(
    `/v1/twins/${input.session.twinId}/artifacts/${input.artifactId}/retry`,
    {},
    input.session,
    input.onSessionRefreshed,
  )
}

export function artifactStatusErrorMessage(error: unknown) {
  return errorMessage(error)
}
