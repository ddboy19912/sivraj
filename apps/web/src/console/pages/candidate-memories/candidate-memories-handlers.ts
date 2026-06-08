import { requireConsoleSession } from '@/console/console-session'
import {
  candidateMemoriesErrorMessage,
  fetchCandidateMemories,
  submitCandidateMemoryFeedback,
} from '@/console/pages/candidate-memories/candidate-memories-actions'
import type { CandidateMemoryRow } from '@/types/console.types'
import type { Session } from '@/lib/session'

type CandidateMemoriesHandlersInput = {
  session: Session | null
  isSessionForWallet: boolean
  artifactId: string
  onSessionRefreshed: (session: Session) => void
  setRows: (rows: CandidateMemoryRow[]) => void
  setStatus: (status: string | null) => void
  setIsLoading: (value: boolean) => void
  setIsSubmitting: (value: boolean) => void
}

export function createCandidateMemoriesHandlers(input: CandidateMemoriesHandlersInput) {
  async function loadCandidates() {
    if (!requireConsoleSession(input.session, input.isSessionForWallet, input.setStatus)) {
      return
    }

    input.setIsLoading(true)

    try {
      const candidateMemories = await fetchCandidateMemories({
        session: input.session!,
        artifactId: input.artifactId,
        onSessionRefreshed: input.onSessionRefreshed,
      })
      input.setRows(candidateMemories)
      input.setStatus(`${candidateMemories.length} candidate memory row(s).`)
    } catch (error) {
      input.setRows([])
      input.setStatus(candidateMemoriesErrorMessage(error))
    } finally {
      input.setIsLoading(false)
    }
  }

  async function submitFeedback(candidateId: string, feedbackType: string) {
    if (!input.session || !input.isSessionForWallet) {
      return
    }

    input.setIsSubmitting(true)

    try {
      await submitCandidateMemoryFeedback({
        session: input.session,
        candidateId,
        feedbackType,
        onSessionRefreshed: input.onSessionRefreshed,
      })
      input.setStatus(`Feedback "${feedbackType}" recorded for ${candidateId}.`)
      await loadCandidates()
    } catch (error) {
      input.setStatus(candidateMemoriesErrorMessage(error))
    } finally {
      input.setIsSubmitting(false)
    }
  }

  return { loadCandidates, submitFeedback }
}
