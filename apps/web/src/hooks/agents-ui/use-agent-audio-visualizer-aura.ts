import { type LocalAudioTrack, type RemoteAudioTrack } from 'livekit-client';
import {
  type AgentState,
  type TrackReference,
  type TrackReferenceOrPlaceholder,
  useTrackVolume,
} from '@livekit/components-react';

const DEFAULT_SPEED = 10;
const DEFAULT_SCALE = 0.2;
const DEFAULT_BRIGHTNESS = 1.5;

function resolveVisualizerSpeed(state: AgentState | undefined) {
  switch (state) {
    case 'speaking':
      return 70;
    case 'thinking':
    case 'connecting':
    case 'initializing':
      return 30;
    case 'listening':
    case 'pre-connect-buffering':
      return 20;
    case 'idle':
    case 'failed':
    case 'disconnected':
    default:
      return DEFAULT_SPEED;
  }
}

export function useAgentAudioVisualizerAura(
  state: AgentState | undefined,
  audioTrack?: LocalAudioTrack | RemoteAudioTrack | TrackReferenceOrPlaceholder,
) {
  const speed = resolveVisualizerSpeed(state);
  const volume = useTrackVolume(audioTrack as TrackReference, {
    fftSize: 512,
    smoothingTimeConstant: 0.55,
  });
  const visualState = resolveVisualizerState(state, volume);

  return {
    speed,
    ...visualState,
  };
}

function resolveVisualizerState(
  state: AgentState | undefined,
  volume: number,
) {
  switch (state) {
    case 'listening':
    case 'pre-connect-buffering':
      return {
        scale: 0.3,
        amplitude: 1.0,
        frequency: 0.7,
        brightness: 1.8,
      };
    case 'thinking':
    case 'connecting':
    case 'initializing':
      return {
        scale: 0.3,
        amplitude: 0.5,
        frequency: 1,
        brightness: 1.8,
      };
    case 'speaking':
      return {
        scale: volume > 0 ? 0.2 + 0.2 * volume : 0.3,
        amplitude: 0.75,
        frequency: 1.25,
        brightness: DEFAULT_BRIGHTNESS,
      };
    case 'idle':
    case 'failed':
    case 'disconnected':
    default:
      return {
        scale: DEFAULT_SCALE,
        amplitude: 1.2,
        frequency: 0.4,
        brightness: 1.0,
      };
  }
}
