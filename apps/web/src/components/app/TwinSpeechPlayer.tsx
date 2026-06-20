import { useEffect, useRef, type RefObject } from "react";
import type { SpeechPlaybackCommand, TwinRuntimeEvent } from "@/types/twin.types";

type TwinSpeechPlayerProps = {
  command: SpeechPlaybackCommand;
  audioRef?: RefObject<HTMLAudioElement | null>;
  onRuntimeEvent: (event: TwinRuntimeEvent) => void;
  onPlaybackCompleted: (eventId: string) => Promise<void>;
};

export function TwinSpeechPlayer({
  command,
  audioRef: audioRefProp,
  onRuntimeEvent,
  onPlaybackCompleted,
}: TwinSpeechPlayerProps) {
  const localAudioRef = useRef<HTMLAudioElement | null>(null);
  const audioRef = audioRefProp ?? localAudioRef;
  const terminalHandledRef = useRef(false);

  useEffect(() => {
    terminalHandledRef.current = false;
  }, [command?.clipId]);

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
  }, [audioRef, command, onRuntimeEvent]);

  function handleFailure(eventId: string, reason: string) {
    if (terminalHandledRef.current) {
      return;
    }

    terminalHandledRef.current = true;
    onRuntimeEvent({ type: "speech.failed", eventId, reason });
  }

  function handleEnded(currentCommand: NonNullable<SpeechPlaybackCommand>) {
    if (terminalHandledRef.current) {
      return;
    }

    terminalHandledRef.current = true;

    if (!currentCommand.isFinalClip) {
      // More speech is queued for this turn: advance to the next clip without
      // tearing down the turn so playback stays gapless.
      onRuntimeEvent({
        type: "speech.clip_advanced",
        eventId: currentCommand.eventId,
      });
      return;
    }

    void onPlaybackCompleted(currentCommand.eventId).catch((error: unknown) => {
      onRuntimeEvent({
        type: "speech.failed",
        eventId: currentCommand.eventId,
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
      onEnded={() => handleEnded(command)}
      onError={() => handleFailure(command.eventId, "Playback failed.")}
    >
      <track kind="captions" src="data:text/vtt,WEBVTT%0A" />
    </audio>
  );
}
