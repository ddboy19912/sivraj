import type { Session } from "@/lib/session";

export type TwinSpeechFailureMode = "visible_retry" | "quiet";

export type TwinRuntimeEvent =
  | {
      type: "first_meet_intro.requested";
      eventId: string;
      dedupeKey: string;
      text: string;
      voiceStyle: "energetic";
    }
  | {
      type: "speech.requested";
      eventId: string;
      dedupeKey: string;
      text: string;
      voiceStyle: "energetic";
      sourceEventId?: string;
      failureMode?: TwinSpeechFailureMode;
    }
  | {
      type: "speech.audio_chunk";
      eventId: string;
      dedupeKey: string;
      audioUrl: string;
      sourceEventId?: string;
    }
  | { type: "speech.stream_closed"; eventId: string }
  | { type: "speech.clip_advanced"; eventId: string }
  | { type: "speech.started"; eventId: string }
  | { type: "speech.completed"; eventId: string }
  | {
      type: "speech.failed";
      eventId: string;
      reason: string;
      failureMode?: TwinSpeechFailureMode;
    }
  | { type: "agent.thinking_started"; eventId: string; label?: string }
  | { type: "agent.thinking_completed"; eventId: string }
  | { type: "agent.listening_started"; eventId: string }
  | { type: "agent.listening_completed"; eventId: string }
  | { type: "runtime.cancelled"; eventId?: string; reason?: string };

export type TwinRuntimeState =
  | { status: "idle"; processedEventIds: string[] }
  | {
      status: "preparing_speech";
      eventId: string;
      dedupeKey: string;
      text: string;
      voiceStyle: "energetic";
      sourceEventId?: string;
      failureMode?: TwinSpeechFailureMode;
      processedEventIds: string[];
    }
  | {
      status: "speaking";
      eventId: string;
      dedupeKey: string;
      text: string;
      clips: string[];
      clipCursor: number;
      streamClosed: boolean;
      sourceEventId?: string;
      failureMode?: TwinSpeechFailureMode;
      processedEventIds: string[];
    }
  | { status: "listening"; eventId: string; processedEventIds: string[] }
  | {
      status: "thinking";
      eventId: string;
      label?: string;
      processedEventIds: string[];
    }
  | {
      status: "failed";
      eventId: string;
      dedupeKey?: string;
      text?: string;
      reason: string;
      retryable: boolean;
      sourceEventId?: string;
      processedEventIds: string[];
    };

export type SpeechPlaybackCommand = {
  eventId: string;
  clipId: string;
  audioUrl: string;
  isFinalClip: boolean;
} | null;

export type TwinRuntimeInput = {
  events: TwinRuntimeEvent[];
  session: Session | null;
  setSession: (session: Session) => void;
};

export type TwinRuntimeController = {
  runtimeState: TwinRuntimeState;
  dispatchRuntimeEvent: (event: TwinRuntimeEvent) => void;
  speechPlaybackCommand: SpeechPlaybackCommand;
  consumeRuntimeEvent: (eventId: string) => Promise<void>;
};
