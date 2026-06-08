import { requireConsoleSession } from '@/console/console-session'
import {
  agentPermissionsErrorMessage,
  createAgentPermissionToken,
  fetchAgentClients,
  revokeAgentGrant,
} from '@/console/pages/agent-permissions/agent-permissions-actions'
import type { AgentClientRow } from '@/types/console.types'
import type { Session } from '@/lib/session'

type AgentPermissionsHandlersInput = {
  session: Session | null
  isSessionForWallet: boolean
  onSessionRefreshed: (session: Session) => void
  agentName: string
  expiresInMinutes: number
  setClients: (clients: AgentClientRow[]) => void
  setTokenPreview: (token: string) => void
  setStatus: (status: string | null) => void
  setIsLoading: (value: boolean) => void
  setIsSubmitting: (value: boolean) => void
}

export function createAgentPermissionsHandlers(input: AgentPermissionsHandlersInput) {
  async function loadClients() {
    if (!requireConsoleSession(input.session, input.isSessionForWallet, input.setStatus)) {
      return
    }

    input.setIsLoading(true)

    try {
      const response = await fetchAgentClients(input.session!, input.onSessionRefreshed)
      input.setClients(response.clients)
      input.setStatus(`${response.clients.length} coding-agent permission grant(s).`)
    } catch (error) {
      input.setClients([])
      input.setStatus(agentPermissionsErrorMessage(error))
    } finally {
      input.setIsLoading(false)
    }
  }

  async function createAgentToken() {
    if (!requireConsoleSession(input.session, input.isSessionForWallet, input.setStatus)) {
      return
    }

    input.setIsSubmitting(true)

    try {
      const response = await createAgentPermissionToken({
        session: input.session!,
        agentName: input.agentName,
        expiresInMinutes: input.expiresInMinutes,
        onSessionRefreshed: input.onSessionRefreshed,
      })
      input.setTokenPreview(response.token)
      input.setStatus(`Created ${input.agentName} token. Copy it now; Sivraj will not show the token again.`)
      await loadClients()
    } catch (error) {
      input.setStatus(agentPermissionsErrorMessage(error))
    } finally {
      input.setIsSubmitting(false)
    }
  }

  async function revokeGrant(client: AgentClientRow) {
    if (!input.session || !input.isSessionForWallet) {
      return
    }

    input.setIsSubmitting(true)

    try {
      const revokedId = await revokeAgentGrant({
        session: input.session,
        client,
        onSessionRefreshed: input.onSessionRefreshed,
      })
      input.setStatus(
        `Revoked grant ${client.grantId || revokedId}. Existing JWTs expire at their token expiry; new refresh/delegation should be denied by policy.`,
      )
      await loadClients()
    } catch (error) {
      input.setStatus(agentPermissionsErrorMessage(error))
    } finally {
      input.setIsSubmitting(false)
    }
  }

  return { createAgentToken, loadClients, revokeGrant }
}
