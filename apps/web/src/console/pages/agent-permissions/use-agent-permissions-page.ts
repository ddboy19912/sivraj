import { useReducer, useState } from 'react'
import { useConsoleSessionEffect } from '@/console/console-page-ui'
import { createAgentPermissionsHandlers } from '@/console/pages/agent-permissions/agent-permissions-handlers'
import { useConsoleContext } from '@/console/context'
import type { AgentClientRow } from '@/types/console.types'

function booleanReducer(_current: boolean, next: boolean) {
  return next
}

export function useAgentPermissionsPage() {
  const { session, isSessionForWallet, onSessionRefreshed } = useConsoleContext()
  const [clients, setClients] = useState<AgentClientRow[]>([])
  const [agentName, setAgentName] = useState('Codex')
  const [expiresInMinutes, setExpiresInMinutes] = useState(1440)
  const [tokenPreview, setTokenPreview] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useReducer(booleanReducer, false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handlers = createAgentPermissionsHandlers({
    session,
    isSessionForWallet,
    onSessionRefreshed,
    agentName,
    expiresInMinutes,
    setClients,
    setTokenPreview,
    setStatus,
    setIsLoading,
    setIsSubmitting,
  })

  useConsoleSessionEffect(isSessionForWallet, session?.twinId, handlers.loadClients)

  return {
    agentName,
    clients,
    createAgentToken: handlers.createAgentToken,
    expiresInMinutes,
    isLoading,
    isSubmitting,
    loadClients: handlers.loadClients,
    revokeGrant: handlers.revokeGrant,
    setAgentName,
    setExpiresInMinutes,
    status,
    tokenPreview,
  }
}
