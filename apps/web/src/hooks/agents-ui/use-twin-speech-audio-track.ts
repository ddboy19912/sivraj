import { LocalAudioTrack } from "livekit-client";
import { useEffect, useState, type RefObject } from "react";
import type { AgentAudioTrack } from "@/types/agent-audio.types";
import type { SpeechPlaybackCommand } from "@/types/twin.types";

type TwinSpeechAudioGraph = {
  audioContext: AudioContext;
  track: LocalAudioTrack;
  source: MediaElementAudioSourceNode;
};

type TwinSpeechAudioState = {
  hasCommand: boolean;
  track?: AgentAudioTrack;
};

export function useTwinSpeechAudioTrack(
  audioRef: RefObject<HTMLAudioElement | null>,
  command: SpeechPlaybackCommand,
): AgentAudioTrack | undefined {
  const hasCommand = Boolean(command);
  const [audioState, setAudioState] = useState<TwinSpeechAudioState>({
    hasCommand,
  });

  useEffect(() => {
    if (!hasCommand) {
      return;
    }

    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    let graph: TwinSpeechAudioGraph | null = null;
    let cancelled = false;

    function closeGraph() {
      graph?.track.stop();
      graph?.source.disconnect();
      void graph?.audioContext.close();
      graph = null;
    }

    function attachTrack() {
      if (cancelled || graph || !audioRef.current) {
        return;
      }

      const audioContext = new AudioContext();
      const destination = audioContext.createMediaStreamDestination();
      let source: MediaElementAudioSourceNode;

      try {
        source = audioContext.createMediaElementSource(audioRef.current);
      } catch {
        void audioContext.close();
        return;
      }

      source.connect(destination);
      source.connect(audioContext.destination);

      const mediaTrack = destination.stream.getAudioTracks()[0];
      if (!mediaTrack) {
        void audioContext.close();
        return;
      }

      graph = {
        audioContext,
        source,
        track: new LocalAudioTrack(mediaTrack, undefined, true, audioContext),
      };
      setAudioState({ hasCommand: true, track: graph.track });
    }

    audio.addEventListener("playing", attachTrack);
    if (!audio.paused && audio.currentTime > 0) {
      attachTrack();
    }

    return () => {
      cancelled = true;
      audio.removeEventListener("playing", attachTrack);
      closeGraph();
    };
  }, [audioRef, hasCommand]);

  if (audioState.hasCommand !== hasCommand) {
    setAudioState({ hasCommand });
    return undefined;
  }

  return audioState.track;
}
