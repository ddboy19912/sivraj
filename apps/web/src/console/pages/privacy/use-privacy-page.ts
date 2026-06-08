import { useState } from 'react'
import { requireConsoleSession } from '@/console/console-session'
import { fetchPrivacyCheck, privacyErrorMessage } from '@/console/pages/privacy/privacy-actions'
import { useConsoleContext } from '@/console/context'
import type { PrivacyCheckResponse } from '@/types/console.types'

export function usePrivacyPage() {
  const { session, isSessionForWallet, onSessionRefreshed, artifactId, setArtifactId } =
    useConsoleContext()
  const [inputArtifactId, setInputArtifactId] = useState(artifactId)
  const [report, setReport] = useState<PrivacyCheckResponse | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  async function loadPrivacyCheck(id?: string) {
    const targetArtifactId = (id ?? inputArtifactId).trim()

    if (!requireConsoleSession(session, isSessionForWallet, setStatus)) {
      return
    }

    if (!targetArtifactId) {
      setStatus('Enter an artifact ID.')
      return
    }

    setIsLoading(true)

    try {
      const response = await fetchPrivacyCheck({
        session: session!,
        artifactId: targetArtifactId,
        onSessionRefreshed,
      })
      setReport(response)
      setArtifactId(targetArtifactId)
      setStatus(response.allChecksPassed ? 'All privacy checks passed.' : 'One or more privacy checks failed.')
      setIsLoading(false)
    } catch (error) {
      setReport(null)
      setStatus(privacyErrorMessage(error))
      setIsLoading(false)
    }
  }

  return {
    inputArtifactId,
    isLoading,
    loadPrivacyCheck,
    report,
    setInputArtifactId,
    status,
  }
}
