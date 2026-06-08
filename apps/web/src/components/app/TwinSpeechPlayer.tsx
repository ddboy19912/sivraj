import { useEffect, useRef } from "react";
import type { SpeechPlaybackCommand, TwinRuntimeEvent } from "@/types/twin.types";

type TwinSpeechPlayerProps = {
  command: SpeechPlaybackCommand;
  onRuntimeEvent: (event: TwinRuntimeEvent) => void;
  onPlaybackCompleted: (eventId: string) => Promise<void>;
};

export function TwinSpeechPlayer({
  command,
  onRuntimeEvent,
  onPlaybackCompleted,
}: TwinSpeechPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const terminalHandledRef = useRef(false);

  useEffect(() => {
    terminalHandledRef.current = false;
  }, [command?.eventId]);

  useEffect(() => {
    if (!command) {
      return;
    }

    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    void audio.play().catch((error: unknown) => {
      if (terminalHandledRef.current) {
        return;
      }

      terminalHandledRef.current = true;
      onRuntimeEvent({
        type: "speech.failed",
        eventId: command.eventId,
        reason: error instanceof Error ? error.message : "Playback failed.",
      });
    });
  }, [command, onRuntimeEvent]);

  function handleFailure(eventId: string, reason: string) {
    if (terminalHandledRef.current) {
      return;
    }

    terminalHandledRef.current = true;
    onRuntimeEvent({ type: "speech.failed", eventId, reason });
  }

  function handleCompleted(eventId: string) {
    if (terminalHandledRef.current) {
      return;
    }

    terminalHandledRef.current = true;
    void onPlaybackCompleted(eventId).catch((error: unknown) => {
      onRuntimeEvent({
        type: "speech.failed",
        eventId,
        reason: error instanceof Error ? error.message : "Speech consumption failed.",
      });
    });
  }

  if (!command) {
    return null;
  }

  return (
    <audio
      ref={audioRef}
      className="pointer-events-none absolute size-px opacity-0"
      src={command.audioUrl}
      autoPlay
      aria-label="Twin speech audio"
      tabIndex={-1}
      onPlaying={() =>
        onRuntimeEvent({ type: "speech.started", eventId: command.eventId })
      }
      onEnded={() => handleCompleted(command.eventId)}
      onError={() => handleFailure(command.eventId, "Playback failed.")}
    >
      <track kind="captions" src="data:text/vtt,WEBVTT%0A" />
    </audio>
  );
}
