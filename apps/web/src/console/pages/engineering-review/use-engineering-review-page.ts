import { useState } from 'react'
import { requireConsoleSession } from '@/console/console-session'
import type { EngineeringProjectFields } from '@/types/console.types'
import {
  engineeringReviewErrorMessage,
  fetchEngineeringReviewQueue,
  submitEngineeringReviewAction,
} from '@/console/pages/engineering-review/engineering-review-actions'
import { useConsoleContext } from '@/console/context'
import type { EngineeringReviewQueueResponse } from '@/types/console.types'

export function useEngineeringReviewPage() {
  const { session, isSessionForWallet, onSessionRefreshed } = useConsoleContext()
  const [projectFields, setProjectFields] = useState<EngineeringProjectFields>({
    projectName: 'Sivraj',
    repoName: 'sivraj',
    packageName: 'sivraj',
    packageManager: 'pnpm',
    frameworks: 'vite, react',
  })
  const [queue, setQueue] = useState<EngineeringReviewQueueResponse | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [submittingId, setSubmittingId] = useState<string | null>(null)

  async function loadQueue() {
    if (
      !requireConsoleSession(
        session,
        isSessionForWallet,
        setStatus,
        'Connect wallet and sign in to review engineering instructions.',
      )
    ) {
      return
    }

    setIsLoading(true)

    try {
      const response = await fetchEngineeringReviewQueue({
        session: session!,
        onSessionRefreshed,
        projectFields,
      })
      setQueue(response)
      setStatus(`${response.summary.issueCount} instruction issue(s) need review.`)
      setIsLoading(false)
    } catch (error) {
      setQueue(null)
      setStatus(engineeringReviewErrorMessage(error))
      setIsLoading(false)
    }
  }

  async function submitAction(candidateId: string, action: string) {
    if (!session || !isSessionForWallet) {
      return
    }

    setSubmittingId(candidateId)

    try {
      await submitEngineeringReviewAction({
        session,
        candidateId,
        action,
        onSessionRefreshed,
      })
      setStatus(`Instruction ${candidateId.slice(0, 8)}… marked ${action}.`)
      await loadQueue()
      setSubmittingId(null)
    } catch (error) {
      setStatus(engineeringReviewErrorMessage(error))
      setSubmittingId(null)
    }
  }

  function updateProjectField(field: keyof EngineeringProjectFields, value: string) {
    setProjectFields((current) => ({ ...current, [field]: value }))
  }

  return {
    isLoading,
    loadQueue,
    projectFields,
    queue,
    status,
    submitAction,
    submittingId,
    updateProjectField,
  }
}
