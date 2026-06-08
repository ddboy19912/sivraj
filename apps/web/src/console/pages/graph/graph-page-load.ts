import { errorMessage, getAuthedJson } from '@/lib/api'
import { applyPatternView, type DisplayNode } from '@/console/pages/graph/graph-page-utils'
import type { Session } from '@/lib/session'
import type { GraphResponse } from '@/types/console.types'

export async function fetchGraphData(input: {
  session: Session
  nodeTypeFilter: string
  artifactId: string
  onSessionRefreshed: (session: Session) => void
}): Promise<{ nodes: DisplayNode[]; edges: GraphResponse['edges'] }> {
  const params = new URLSearchParams()
  const apiNodeType = input.nodeTypeFilter === 'pattern' ? 'other' : input.nodeTypeFilter

  if (apiNodeType) {
    params.set('nodeType', apiNodeType)
  }

  if (input.artifactId) {
    params.set('artifactId', input.artifactId)
  }

  const query = params.size > 0 ? `?${params.toString()}` : ''
  const response = await getAuthedJson<GraphResponse>(
    `/v1/twins/${input.session.twinId}/graph${query}`,
    input.session,
    input.onSessionRefreshed,
  )

  return input.nodeTypeFilter === 'pattern'
    ? applyPatternView(response)
    : { nodes: response.nodes, edges: response.edges }
}

export function graphPageErrorMessage(error: unknown) {
  return errorMessage(error)
}
