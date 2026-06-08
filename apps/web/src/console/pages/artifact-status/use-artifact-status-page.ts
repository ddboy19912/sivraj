import { useState } from 'react'
import { useArtifactEventStream } from '@/console/pages/artifact-status/artifact-event-stream'
import {
  artifactStatusErrorMessage,
  loadArtifactDetail,
  retryArtifactProcessing,
} from '@/console/pages/artifact-status/artifact-status-actions'
import { useConsoleContext } from '@/console/context'
import type { ArtifactDetail, ArtifactStatusEvent } from '@/types/console.types'

export function useArtifactStatusPage() {
  const { session, isSessionForWallet, onSessionRefreshed, artifactId, setArtifactId } =
    useConsoleContext()
  const [inputArtifactId, setInputArtifactId] = useState(artifactId)
  const [detail, setDetail] = useState<ArtifactDetail | null>(null)
  const [liveEvent, setLiveEvent] = useState<ArtifactStatusEvent | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isRetrying, setIsRetrying] = useState(false)
  const [streamNonce, setStreamNonce] = useState(0)

  useArtifactEventStream({
    session,
    isSessionForWallet,
    artifactId: inputArtifactId,
    streamNonce,
    onEvent: setLiveEvent,
  })

  async function loadDetail(id?: string) {
    const targetArtifactId = (id ?? inputArtifactId).trim()

    if (!session || !isSessionForWallet) {
      setStatus('Sign in required.')
      return
    }

    if (!targetArtifactId) {
      setStatus('Enter an artifact ID.')
      return
    }

    setIsLoading(true)
    setStatus('Loading artifact detail...')

    try {
      const artifact = await loadArtifactDetail({
        session,
        artifactId: targetArtifactId,
        onSessionRefreshed,
      })
      setDetail(artifact)
      setArtifactId(targetArtifactId)
      setStatus('Artifact detail loaded.')
      setStreamNonce((value) => value + 1)
      setIsLoading(false)
    } catch (error) {
      setDetail(null)
      setStatus(artifactStatusErrorMessage(error))
      setIsLoading(false)
    }
  }

  async function handleRetry() {
    if (!session || !isSessionForWallet || !inputArtifactId.trim()) {
      return
    }

    setIsRetrying(true)

    try {
      await retryArtifactProcessing({
        session,
        artifactId: inputArtifactId.trim(),
        onSessionRefreshed,
      })
      setStatus('Retry queued.')
      setStreamNonce((value) => value + 1)
      await loadDetail(inputArtifactId.trim())
      setIsRetrying(false)
    } catch (error) {
      setStatus(artifactStatusErrorMessage(error))
      setIsRetrying(false)
    }
  }

  const canRetry =
    Boolean(detail) &&
    (detail?.ingestionStatus === 'failed' ||
      detail?.processingReason === 'encrypted_decryption_retrying')

  return {
    canRetry,
    detail,
    handleRetry,
    inputArtifactId,
    isLoading,
    isRetrying,
    liveEvent,
    loadDetail,
    setInputArtifactId,
    status,
  }
}
