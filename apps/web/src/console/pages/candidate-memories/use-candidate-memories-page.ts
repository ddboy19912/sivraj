import { useReducer, useState } from 'react'
import { useConsoleSessionEffect } from '@/console/console-page-ui'
import { createCandidateMemoriesHandlers } from '@/console/pages/candidate-memories/candidate-memories-handlers'
import { useConsoleContext } from '@/console/context'
import type { CandidateMemoryRow } from '@/types/console.types'

function booleanReducer(_current: boolean, next: boolean) {
  return next
}

export function useCandidateMemoriesPage() {
  const {
    session,
    isSessionForWallet,
    onSessionRefreshed,
    artifactId,
    selectedCandidateId,
    setSelectedCandidateId,
  } = useConsoleContext()
  const [rows, setRows] = useState<CandidateMemoryRow[]>([])
  const [status, setStatus] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useReducer(booleanReducer, false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handlers = createCandidateMemoriesHandlers({
    session,
    isSessionForWallet,
    artifactId,
    onSessionRefreshed,
    setRows,
    setStatus,
    setIsLoading,
    setIsSubmitting,
  })

  useConsoleSessionEffect(isSessionForWallet, session?.twinId, handlers.loadCandidates, artifactId)

  return {
    artifactId,
    isLoading,
    isSubmitting,
    loadCandidates: handlers.loadCandidates,
    rows,
    selectedCandidateId,
    setSelectedCandidateId,
    status,
    submitFeedback: handlers.submitFeedback,
  }
}
