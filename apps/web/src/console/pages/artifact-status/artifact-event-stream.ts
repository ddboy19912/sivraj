import { useEffect } from 'react'
import { API_URL } from '@/lib/api'
import type { Session } from '@/lib/session'
import type { ArtifactStatusEvent } from '@/types/console.types'

export function useArtifactEventStream(input: {
  session: Session | null
  isSessionForWallet: boolean
  artifactId: string
  streamNonce: number
  onEvent: (event: ArtifactStatusEvent) => void
}) {
  useEffect(() => {
    if (!input.session || !input.isSessionForWallet || !input.artifactId.trim()) {
      return
    }

    let cancelled = false
    const controller = new AbortController()

    void consumeArtifactEventStream({
      session: input.session,
      artifactId: input.artifactId.trim(),
      signal: controller.signal,
      isCancelled: () => cancelled,
      onEvent: input.onEvent,
    })

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [input.artifactId, input.isSessionForWallet, input.onEvent, input.session, input.streamNonce])
}

async function consumeArtifactEventStream(input: {
  session: Session
  artifactId: string
  signal: AbortSignal
  isCancelled: () => boolean
  onEvent: (event: ArtifactStatusEvent) => void
}) {
  try {
    const response = await fetch(
      `${API_URL}/v1/twins/${input.session.twinId}/artifacts/${input.artifactId}/events`,
      {
        headers: { authorization: `Bearer ${input.session.token}` },
        signal: input.signal,
      },
    )

    if (!response.ok || !response.body) {
      return
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    const readNextChunk = async (): Promise<void> => {
      if (input.isCancelled()) {
        return
      }

      const { done, value } = await reader.read()
      if (done) {
        return
      }

      buffer += decoder.decode(value, { stream: true })
      buffer = drainArtifactEventBuffer(buffer, input.isCancelled, input.onEvent)

      await readNextChunk()
    }

    await readNextChunk()
  } catch {
    // Ignore stream errors during refresh/unmount.
  }
}

function drainArtifactEventBuffer(
  buffer: string,
  isCancelled: () => boolean,
  onEvent: (event: ArtifactStatusEvent) => void,
): string {
  const chunks = buffer.split('\n\n')
  const remaining = chunks.pop() ?? ''

  for (const chunk of chunks) {
    const event = parseArtifactStatusEvent(chunk)

    if (event && !isCancelled()) {
      onEvent(event)
    }
  }

  return remaining
}

function parseArtifactStatusEvent(chunk: string): ArtifactStatusEvent | null {
  let dataLine: string | null = null

  for (const line of chunk.split('\n')) {
    if (line.startsWith('data:')) {
      dataLine = line
      break
    }
  }

  if (!dataLine) {
    return null
  }

  return JSON.parse(dataLine.slice(5).trim()) as ArtifactStatusEvent
}
