import type {
  AgentAudioSnapshot,
  LiveKitAgentAudioInput,
} from "@/types/agent-audio.types";
import type { AgentState } from "@livekit/components-react";
import type { SpeechPlaybackCommand } from "@/types/twin.types";

type ResolveAgentAudioInput = {
  fallbackState: AgentState;
  liveKit?: LiveKitAgentAudioInput | null;
  twinSpeechTrack?: AgentAudioSnapshot["audioTrack"];
  speechCommand: SpeechPlaybackCommand;
};

export function resolveAgentAudio({
  fallbackState,
  liveKit,
  twinSpeechTrack,
  speechCommand,
}: ResolveAgentAudioInput): AgentAudioSnapshot {
  if (liveKit) {
    return {
      state: liveKit.state,
      audioTrack: liveKit.audioTrack,
      source: "livekit",
    };
  }

  if (speechCommand && twinSpeechTrack) {
    return {
      state: "speaking",
      audioTrack: twinSpeechTrack,
      source: "twin-speech",
    };
  }

  return {
    state: fallbackState,
    source: "twin-runtime",
  };
}
