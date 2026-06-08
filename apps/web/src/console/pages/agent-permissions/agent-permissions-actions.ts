import { errorMessage, getAuthedJson, postAuthedJson } from '@/lib/api'
import type { Session } from '@/lib/session'
import type { AgentClientRow, AgentClientsResponse } from '@/types/console.types'

const DEFAULT_AGENT_SCOPES = [
  'agent:context:read',
  'agent:sources:read',
  'agent:project_profile:read',
  'agent:memory:search',
  'agent:writeback:create',
] as const

export async function fetchAgentClients(
  session: Session,
  onSessionRefreshed: (session: Session) => void,
) {
  return getAuthedJson<AgentClientsResponse>(
    `/v1/twins/${session.twinId}/agents/clients`,
    session,
    onSessionRefreshed,
  )
}

export async function createAgentPermissionToken(input: {
  session: Session
  agentName: string
  expiresInMinutes: number
  onSessionRefreshed: (session: Session) => void
}) {
  return postAuthedJson<{
    token: string
    clientId: string
    grantId: string
    expiresAt: string
  }>(
    `/v1/twins/${input.session.twinId}/agents/tokens`,
    {
      agentName: input.agentName,
      scopes: DEFAULT_AGENT_SCOPES,
      expiresInMinutes: input.expiresInMinutes,
    },
    input.session,
    input.onSessionRefreshed,
  )
}

export async function revokeAgentGrant(input: {
  session: Session
  client: AgentClientRow
  onSessionRefreshed: (session: Session) => void
}) {
  const revokeId = input.client.grantId || input.client.clientId
  if (!revokeId) {
    throw new Error('Cannot revoke this grant because the API did not return a grant or client id.')
  }

  await postAuthedJson(
    `/v1/twins/${input.session.twinId}/agents/clients/${revokeId}/revoke`,
    {},
    input.session,
    input.onSessionRefreshed,
  )

  return input.client.grantId || revokeId
}

export function agentPermissionsErrorMessage(error: unknown) {
  return errorMessage(error)
}
