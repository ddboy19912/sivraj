import { type LocalAudioTrack, type RemoteAudioTrack } from 'livekit-client';
import {
  type AgentState,
  type TrackReference,
  type TrackReferenceOrPlaceholder,
  useTrackVolume,
} from '@livekit/components-react';
import { resolveAuraVisualizerValues } from '@/hooks/agents-ui/aura-visualizer-values';

export function useAgentAudioVisualizerAura(
  state: AgentState | undefined,
  audioTrack?: LocalAudioTrack | RemoteAudioTrack | TrackReferenceOrPlaceholder,
) {
  const volume = useTrackVolume(audioTrack as TrackReference, {
    fftSize: 512,
    smoothingTimeConstant: 0.55,
  });

  return resolveAuraVisualizerValues(state, volume);
}
