import { useState } from 'react'
import { useConsoleSessionEffect } from '@/console/console-page-ui'
import { requireConsoleSession } from '@/console/console-session'
import {
  fetchReflectionRuns,
  generateWeeklyReflection,
  reflectionsErrorMessage,
} from '@/console/pages/reflections/reflections-actions'
import { useConsoleContext } from '@/console/context'
import type { ReflectionRun } from '@/types/console.types'

export function useReflectionsPage() {
  const { session, isSessionForWallet, onSessionRefreshed, selectedReflectionId, setSelectedReflectionId } =
    useConsoleContext()
  const [periodStart, setPeriodStart] = useState('')
  const [periodEnd, setPeriodEnd] = useState('')
  const [runs, setRuns] = useState<ReflectionRun[]>([])
  const [status, setStatus] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)

  async function loadRuns() {
    if (!requireConsoleSession(session, isSessionForWallet, setStatus)) {
      return
    }

    setIsLoading(true)

    try {
      const reflections = await fetchReflectionRuns(session!, onSessionRefreshed)
      setRuns(reflections)
      setStatus(`${reflections.length} reflection run(s).`)
      setIsLoading(false)
    } catch (error) {
      setRuns([])
      setStatus(reflectionsErrorMessage(error))
      setIsLoading(false)
    }
  }

  useConsoleSessionEffect(isSessionForWallet, session?.twinId, loadRuns)

  async function handleGenerate(event: React.FormEvent) {
    event.preventDefault()

    if (!session || !isSessionForWallet) {
      setStatus('Sign in required.')
      return
    }

    setIsGenerating(true)

    try {
      const response = await generateWeeklyReflection({
        session,
        periodStart,
        periodEnd,
        onSessionRefreshed,
      })
      setSelectedReflectionId(response.reflectionRunId)
      setStatus(`Weekly reflection queued (${response.reflectionRunId}).`)
      await loadRuns()
      setIsGenerating(false)
    } catch (error) {
      setStatus(reflectionsErrorMessage(error))
      setIsGenerating(false)
    }
  }

  return {
    handleGenerate,
    isGenerating,
    isLoading,
    isSessionForWallet,
    loadRuns,
    periodEnd,
    periodStart,
    runs,
    selectedReflectionId,
    setPeriodEnd,
    setPeriodStart,
    setSelectedReflectionId,
    status,
  }
}
