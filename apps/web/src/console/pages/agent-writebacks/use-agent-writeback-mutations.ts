import { requireConsoleSession } from '@/console/console-session'
import {
  approveAgentWriteback,
  createEncryptedAgentWriteback,
  rejectAgentWriteback,
} from '@/console/pages/agent-writebacks/agent-writeback-actions'
import type { Session } from '@/lib/session'

type WritebackMutationInput = {
  session: Session | null
  isSessionForWallet: boolean
  setStatus: (status: string | null) => void
  setIsSubmitting: (value: boolean) => void
  setArtifactId: (id: string) => void
  setJobId: (id: string) => void
  onSessionRefreshed: (session: Session) => void
  loadWritebacks: () => Promise<void>
}

async function runApproveWriteback(input: WritebackMutationInput, writebackId: string) {
  if (!input.session || !input.isSessionForWallet) {
    return
  }

  input.setIsSubmitting(true)
  try {
    const response = await approveAgentWriteback({
      session: input.session,
      writebackId,
      onSessionRefreshed: input.onSessionRefreshed,
    })
    input.setArtifactId(response.artifactId)
    input.setJobId(response.processingJobId ?? '')
    input.setStatus(
      `Approved writeback ${writebackId}. Artifact ${response.artifactId} queued for ingestion.`,
    )
    await input.loadWritebacks()
  } catch (error) {
    input.setStatus(error instanceof Error ? error.message : 'Approve failed.')
  } finally {
    input.setIsSubmitting(false)
  }
}

async function runRejectWriteback(input: WritebackMutationInput, writebackId: string) {
  if (!input.session || !input.isSessionForWallet) {
    return
  }

  input.setIsSubmitting(true)
  try {
    await rejectAgentWriteback({
      session: input.session,
      writebackId,
      onSessionRefreshed: input.onSessionRefreshed,
    })
    input.setStatus(`Rejected writeback ${writebackId}.`)
    await input.loadWritebacks()
  } catch (error) {
    input.setStatus(error instanceof Error ? error.message : 'Reject failed.')
  } finally {
    input.setIsSubmitting(false)
  }
}

async function runCreateEncryptedWriteback(
  input: WritebackMutationInput,
  form: {
    agentToken: string
    agentName: string
    repo: string
    branch: string
    taskSummary: string
    filesTouched: string
    commandsRun: string
    testsRun: string
    decisions: string
    bugsFound: string
    followUps: string
    userCorrections: string
    setTaskSummary: (value: string) => void
  },
) {
  if (!requireConsoleSession(input.session, input.isSessionForWallet, input.setStatus)) {
    return
  }

  input.setIsSubmitting(true)
  try {
    const response = await createEncryptedAgentWriteback({
      session: input.session!,
      ...form,
    })
    input.setStatus(
      `Created encrypted writeback ${response.writebackId}. Status ${response.status}.`,
    )
    form.setTaskSummary('')
    await input.loadWritebacks()
  } catch (error) {
    input.setStatus(error instanceof Error ? error.message : 'Create failed.')
  } finally {
    input.setIsSubmitting(false)
  }
}

export function createAgentWritebackMutations(input: WritebackMutationInput) {
  return {
    approveWriteback: (writebackId: string) => runApproveWriteback(input, writebackId),
    createEncryptedWriteback: (form: Parameters<typeof runCreateEncryptedWriteback>[1]) =>
      runCreateEncryptedWriteback(input, form),
    rejectWriteback: (writebackId: string) => runRejectWriteback(input, writebackId),
  }
}
