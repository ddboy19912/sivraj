import { useState } from 'react'
import { useConsoleSessionEffect } from '@/console/console-page-ui'
import { requireConsoleSession } from '@/console/console-session'
import { loadAgentWritebacks } from '@/console/pages/agent-writebacks/agent-writeback-actions'
import { useAgentWritebackFormState } from '@/console/pages/agent-writebacks/agent-writeback-form-state'
import { createAgentWritebackMutations } from '@/console/pages/agent-writebacks/use-agent-writeback-mutations'
import { useConsoleContext } from '@/console/context'
import type { AgentWritebackRow } from '@/types/console.types'

export function useAgentWritebacks() {
  const { session, isSessionForWallet, onSessionRefreshed, setArtifactId, setJobId } =
    useConsoleContext()
  const [rows, setRows] = useState<AgentWritebackRow[]>([])
  const [statusFilter, setStatusFilter] = useState('pending')
  const [status, setStatus] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const form = useAgentWritebackFormState()

  async function loadWritebacks() {
    if (!requireConsoleSession(session, isSessionForWallet, setStatus)) {
      return
    }

    setIsLoading(true)
    try {
      const response = await loadAgentWritebacks({
        session: session!,
        statusFilter,
        onSessionRefreshed,
      })
      setRows(response.writebacks)
      setStatus(`${response.writebacks.length} encrypted agent writeback(s).`)
      setIsLoading(false)
    } catch (error) {
      setRows([])
      setStatus(error instanceof Error ? error.message : 'Could not load writebacks.')
      setIsLoading(false)
    }
  }

  const mutations = createAgentWritebackMutations({
    session,
    isSessionForWallet,
    setStatus,
    setIsSubmitting,
    setArtifactId,
    setJobId,
    onSessionRefreshed,
    loadWritebacks,
  })

  useConsoleSessionEffect(isSessionForWallet, session?.twinId, loadWritebacks, statusFilter)

  return {
    ...form,
    approveWriteback: mutations.approveWriteback,
    createEncryptedWriteback: () =>
      mutations.createEncryptedWriteback({
        agentToken: form.agentToken,
        agentName: form.agentName,
        repo: form.repo,
        branch: form.branch,
        taskSummary: form.taskSummary,
        filesTouched: form.filesTouched,
        commandsRun: form.commandsRun,
        testsRun: form.testsRun,
        decisions: form.decisions,
        bugsFound: form.bugsFound,
        followUps: form.followUps,
        userCorrections: form.userCorrections,
        setTaskSummary: form.setTaskSummary,
      }),
    isLoading,
    isSubmitting,
    loadWritebacks,
    rejectWriteback: mutations.rejectWriteback,
    rows,
    setStatusFilter,
    status,
    statusFilter,
  }
}
