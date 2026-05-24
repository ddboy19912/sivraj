import { useEffect, useState } from 'react'
import { API_URL, errorMessage, getAuthedJson, postAuthedJson } from '../../lib/api'
import { useConsoleContext } from '../context'
import type { ArtifactDetail, ArtifactStatusEvent } from '../types'

export function ArtifactStatusPage() {
  const { session, isSessionForWallet, onSessionRefreshed, artifactId, setArtifactId } = useConsoleContext()
  const [inputArtifactId, setInputArtifactId] = useState(artifactId)
  const [detail, setDetail] = useState<ArtifactDetail | null>(null)
  const [liveEvent, setLiveEvent] = useState<ArtifactStatusEvent | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isRetrying, setIsRetrying] = useState(false)
  const [streamNonce, setStreamNonce] = useState(0)

  useEffect(() => {
    setInputArtifactId(artifactId)
  }, [artifactId])

  async function loadDetail(id = inputArtifactId.trim()) {
    if (!session || !isSessionForWallet) {
      setStatus('Sign in required.')
      return
    }

    if (!id) {
      setStatus('Enter an artifact ID.')
      return
    }

    setIsLoading(true)
    setStatus('Loading artifact detail...')

    try {
      const response = await getAuthedJson<{ artifact: ArtifactDetail }>(
        `/v1/twins/${session.twinId}/artifacts/${id}`,
        session,
        onSessionRefreshed,
      )
      setDetail(response.artifact)
      setArtifactId(id)
      setStatus('Artifact detail loaded.')
      setStreamNonce((value) => value + 1)
    } catch (error) {
      setDetail(null)
      setStatus(errorMessage(error))
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    if (!session || !isSessionForWallet || !inputArtifactId.trim()) {
      return
    }

    let cancelled = false
    const controller = new AbortController()

    async function streamStatus() {
      try {
        const response = await fetch(
          `${API_URL}/v1/twins/${session!.twinId}/artifacts/${inputArtifactId.trim()}/events`,
          {
            headers: { authorization: `Bearer ${session!.token}` },
            signal: controller.signal,
          },
        )

        if (!response.ok || !response.body) {
          return
        }

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        while (!cancelled) {
          const { done, value } = await reader.read()

          if (done) {
            break
          }

          buffer += decoder.decode(value, { stream: true })

          while (true) {
            const boundary = buffer.indexOf('\n\n')

            if (boundary === -1) {
              break
            }

            const chunk = buffer.slice(0, boundary)
            buffer = buffer.slice(boundary + 2)
            const dataLine = chunk.split('\n').find((line) => line.startsWith('data:'))

            if (!dataLine) {
              continue
            }

            const payload = JSON.parse(dataLine.slice(5).trim()) as ArtifactStatusEvent

            if (!cancelled) {
              setLiveEvent(payload)
            }
          }
        }
      } catch {
        // Ignore stream errors during refresh/unmount.
      }
    }

    void streamStatus()

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [inputArtifactId, isSessionForWallet, session, streamNonce])

  async function handleRetry() {
    if (!session || !isSessionForWallet || !inputArtifactId.trim()) {
      return
    }

    setIsRetrying(true)

    try {
      await postAuthedJson(
        `/v1/twins/${session.twinId}/artifacts/${inputArtifactId.trim()}/retry`,
        {},
        session,
        onSessionRefreshed,
      )
      setStatus('Retry queued.')
      setStreamNonce((value) => value + 1)
      await loadDetail(inputArtifactId.trim())
    } catch (error) {
      setStatus(errorMessage(error))
    } finally {
      setIsRetrying(false)
    }
  }

  const ingestionStatus = liveEvent?.status ?? detail?.ingestionStatus
  const intelligenceStatus = liveEvent?.intelligenceStatus ?? detail?.intelligenceStatus

  return (
    <section className="console-page">
      <div className="section-heading">
        <p className="eyebrow">Testing console</p>
        <h2>Artifact status</h2>
      </div>

      <div className="console-form inline">
        <label>
          <span>Artifact ID</span>
          <input value={inputArtifactId} onChange={(event) => setInputArtifactId(event.target.value)} />
        </label>
        <div className="console-actions">
          <button className="secondary-action" type="button" disabled={isLoading} onClick={() => void loadDetail()}>
            {isLoading ? 'Loading...' : 'Load / refresh'}
          </button>
          <button
            className="secondary-action"
            type="button"
            disabled={!detail || detail.ingestionStatus !== 'failed' || isRetrying}
            onClick={() => void handleRetry()}
          >
            {isRetrying ? 'Retrying...' : 'Retry failed artifact'}
          </button>
        </div>
      </div>

      {status ? <p className="console-status">{status}</p> : null}

      {detail ? (
        <div className="console-grid">
          <div className="console-panel">
            <h3>Lifecycle</h3>
            <dl>
              <dt>Ingestion status</dt>
              <dd>{ingestionStatus ?? '—'}</dd>
              <dt>Processing reason</dt>
              <dd>{liveEvent?.reason ?? detail.processingReason ?? '—'}</dd>
              <dt>Intelligence status</dt>
              <dd>{intelligenceStatus ?? '—'}</dd>
              <dt>Intelligence stage</dt>
              <dd>{liveEvent?.intelligenceStage ?? '—'}</dd>
              <dt>Source type</dt>
              <dd>{detail.sourceType}</dd>
              <dt>Updated</dt>
              <dd>{detail.updatedAt}</dd>
            </dl>
          </div>

          <div className="console-panel">
            <h3>Timings / counts</h3>
            <dl>
              <dt>Entity extraction</dt>
              <dd>{formatTiming(detail.intelligence, 'entityExtractionMs')}</dd>
              <dt>Memory extraction</dt>
              <dd>{formatTiming(detail.intelligence, 'memoryExtractionMs')}</dd>
              <dt>Candidate memories</dt>
              <dd>{detail.counts.candidateMemories}</dd>
              <dt>Memory fragment</dt>
              <dd>{detail.memoryFragment?.id ?? '—'}</dd>
              <dt>Archive status</dt>
              <dd>{readMetadataString(detail.intelligence, 'archiveStatus') ?? '—'}</dd>
            </dl>
          </div>

          <div className="console-panel wide">
            <h3>Safe metadata</h3>
            <pre>{JSON.stringify({ processing: detail.processing, intelligence: detail.intelligence }, null, 2)}</pre>
          </div>
        </div>
      ) : null}
    </section>
  )
}

function formatTiming(metadata: Record<string, unknown> | undefined, key: string) {
  const value = metadata?.[key]
  return typeof value === 'number' ? `${value} ms` : '—'
}

function readMetadataString(metadata: Record<string, unknown> | undefined, key: string) {
  const value = metadata?.[key]
  return typeof value === 'string' ? value : null
}
