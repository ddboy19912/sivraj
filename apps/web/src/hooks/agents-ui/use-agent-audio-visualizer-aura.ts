import type { LocalAudioTrack, RemoteAudioTrack } from 'livekit-client'
import type {
  AgentState,
  TrackReference,
  TrackReferenceOrPlaceholder,
} from '@livekit/components-react'
import { useTrackVolume } from '@livekit/components-react'
import {
  resolveAuraVisualizerValues,
} from '@/hooks/agents-ui/aura-visualizer-values'

export function useAgentAudioVisualizerAura(
  state: AgentState | undefined,
  audioTrack?: LocalAudioTrack | RemoteAudioTrack | TrackReferenceOrPlaceholder,
) {
  const volume = useTrackVolume(audioTrack as TrackReference, {
    fftSize: 512,
    smoothingTimeConstant: 0.55,
  })

  return resolveAuraVisualizerValues(state, volume)
}
