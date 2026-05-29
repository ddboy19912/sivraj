import { useEffect, useState } from 'react'
import type { LocalAudioTrack, RemoteAudioTrack } from 'livekit-client'
import type {
  AgentState,
  TrackReference,
  TrackReferenceOrPlaceholder,
} from '@livekit/components-react'
import { useTrackVolume } from '@livekit/components-react'

const DEFAULTS = {
  speed: 10,
  amplitude: 2,
  frequency: 0.5,
  scale: 0.2,
  brightness: 1.5,
}

export function useAgentAudioVisualizerAura(
  state: AgentState | undefined,
  audioTrack?: LocalAudioTrack | RemoteAudioTrack | TrackReferenceOrPlaceholder,
) {
  const [values, setValues] = useState(DEFAULTS)
  const volume = useTrackVolume(audioTrack as TrackReference, {
    fftSize: 512,
    smoothingTimeConstant: 0.55,
  })

  useEffect(() => {
    switch (state) {
      case 'idle':
      case 'failed':
      case 'disconnected':
        setValues({
          speed: 10,
          scale: 0.2,
          amplitude: 1.2,
          frequency: 0.4,
          brightness: 1,
        })
        return
      case 'listening':
      case 'pre-connect-buffering':
        setValues({
          speed: 20,
          scale: 0.3,
          amplitude: 1,
          frequency: 0.7,
          brightness: 1.8,
        })
        return
      case 'thinking':
      case 'connecting':
      case 'initializing':
        setValues({
          speed: 30,
          scale: 0.3,
          amplitude: 0.5,
          frequency: 1,
          brightness: 1.9,
        })
        return
      case 'speaking':
        setValues({
          speed: 70,
          scale: 0.22 + 0.18 * volume,
          amplitude: 0.75,
          frequency: 1.25,
          brightness: 1.5 + volume,
        })
        return
      default:
        setValues(DEFAULTS)
    }
  }, [state, volume])

  return values
}
