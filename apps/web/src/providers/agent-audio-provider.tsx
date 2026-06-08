import type { AgentState } from "@livekit/components-react";
import { type ReactNode, useRef } from "react";
import { TwinSpeechPlayer } from "@/components/app/TwinSpeechPlayer";
import { useTwinSpeechAudioTrack } from "@/hooks/agents-ui/use-twin-speech-audio-track";
import { resolveAgentAudio } from "@/lib/agents-ui/resolve-agent-audio";
import { AgentAudioContext } from "@/providers/agent-audio-context";
import type { LiveKitAgentAudioInput } from "@/types/agent-audio.types";
import type {
  SpeechPlaybackCommand,
  TwinRuntimeEvent,
} from "@/types/twin.types";

type AgentAudioProviderProps = {
  fallbackState: AgentState;
  liveKitAudio?: LiveKitAgentAudioInput | null;
  speechPlaybackCommand: SpeechPlaybackCommand;
  onRuntimeEvent: (event: TwinRuntimeEvent) => void;
  onPlaybackCompleted: (eventId: string) => Promise<void>;
  children: ReactNode;
};

export function AgentAudioProvider({
  fallbackState,
  liveKitAudio = null,
  speechPlaybackCommand,
  onRuntimeEvent,
  onPlaybackCompleted,
  children,
}: AgentAudioProviderProps) {
  const speechAudioRef = useRef<HTMLAudioElement | null>(null);
  const twinSpeechTrack = useTwinSpeechAudioTrack(
    speechAudioRef,
    speechPlaybackCommand,
  );

  const contextValue = resolveAgentAudio({
    fallbackState,
    liveKit: liveKitAudio,
    twinSpeechTrack,
    speechCommand: speechPlaybackCommand,
  });

  return (
    <AgentAudioContext value={contextValue}>
      {children}
      <TwinSpeechPlayer
        command={speechPlaybackCommand}
        audioRef={speechAudioRef}
        onRuntimeEvent={onRuntimeEvent}
        onPlaybackCompleted={onPlaybackCompleted}
      />
    </AgentAudioContext>
  );
}
