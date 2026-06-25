import type {
  TwinRuntimeEvent,
  TwinRuntimeState,
} from "@/types/twin.types";

export type TwinRuntimeAction =
  | TwinRuntimeEvent
  | {
      type: "speech.audio_ready";
      eventId: string;
      audioUrl: string;
    };

export function createInitialTwinRuntimeState(): TwinRuntimeState {
  return { status: "idle", processedEventIds: [] };
}

export function twinRuntimeReducer(
  state: TwinRuntimeState,
  action: TwinRuntimeAction,
): TwinRuntimeState {
  switch (action.type) {
    case "first_meet_intro.requested":
      return applySpeechRequest(state, {
        eventId: action.eventId,
        dedupeKey: action.dedupeKey,
        text: action.text,
        voiceStyle: action.voiceStyle,
        sourceEventId: action.eventId,
      });
    case "speech.requested":
      return applySpeechRequest(state, action);
    case "speech.audio_ready":
      if (state.status !== "preparing_speech" || state.eventId !== action.eventId) {
        return state;
      }

      return {
        status: "speaking",
        eventId: state.eventId,
        dedupeKey: state.dedupeKey,
        text: state.text,
        clips: [action.audioUrl],
        clipCursor: 0,
        streamClosed: true,
        sourceEventId: state.sourceEventId,
        failureMode: state.failureMode,
        processedEventIds: state.processedEventIds,
      };
    case "speech.audio_chunk":
      return applySpeechChunk(state, action);
    case "speech.stream_closed":
      if (state.status !== "speaking" || state.eventId !== action.eventId) {
        return state;
      }

      if (state.clipCursor >= state.clips.length) {
        return {
          status: "idle",
          processedEventIds: markProcessed(state.processedEventIds, action.eventId),
        };
      }

      return { ...state, streamClosed: true };
    case "speech.clip_advanced": {
      if (state.status !== "speaking" || state.eventId !== action.eventId) {
        return state;
      }

      const nextCursor = state.clipCursor + 1;
      if (nextCursor >= state.clips.length && state.streamClosed) {
        return {
          status: "idle",
          processedEventIds: markProcessed(state.processedEventIds, action.eventId),
        };
      }

      return { ...state, clipCursor: nextCursor };
    }
    case "speech.started":
      return state;
    case "speech.completed":
      if (!isActiveRuntimeEvent(state, action.eventId)) {
        return state;
      }

      return {
        status: "idle",
        processedEventIds: markProcessed(state.processedEventIds, action.eventId),
      };
    case "speech.failed":
      if (!isActiveRuntimeEvent(state, action.eventId)) {
        return state;
      }

      if (resolveSpeechFailureMode(state, action) === "quiet") {
        return {
          status: "idle",
          processedEventIds: markProcessed(state.processedEventIds, action.eventId),
        };
      }

      return {
        status: "failed",
        eventId: action.eventId,
        dedupeKey: "dedupeKey" in state ? state.dedupeKey : undefined,
        text: "text" in state ? state.text : undefined,
        reason: action.reason,
        retryable: true,
        sourceEventId: "sourceEventId" in state ? state.sourceEventId : undefined,
        processedEventIds: state.processedEventIds,
      };
    case "agent.thinking_started":
      if (hasProcessedEvent(state, action.eventId)) {
        return state;
      }

      return {
        status: "thinking",
        eventId: action.eventId,
        label: action.label,
        processedEventIds: state.processedEventIds,
      };
    case "agent.thinking_completed":
      if (state.status !== "thinking" || state.eventId !== action.eventId) {
        return state;
      }

      return {
        status: "idle",
        processedEventIds: markProcessed(state.processedEventIds, action.eventId),
      };
    case "agent.listening_started":
      if (hasProcessedEvent(state, action.eventId)) {
        return state;
      }

      return {
        status: "listening",
        eventId: action.eventId,
        processedEventIds: state.processedEventIds,
      };
    case "agent.listening_completed":
      if (state.status !== "listening" || state.eventId !== action.eventId) {
        return state;
      }

      return {
        status: "idle",
        processedEventIds: markProcessed(state.processedEventIds, action.eventId),
      };
    case "runtime.cancelled":
      return {
        status: "idle",
        processedEventIds: action.eventId
          ? markProcessed(state.processedEventIds, action.eventId)
          : state.processedEventIds,
      };
    default:
      return state;
  }
}

function applySpeechRequest(
  state: TwinRuntimeState,
  event: Extract<TwinRuntimeEvent, { type: "speech.requested" }> | {
    eventId: string;
    dedupeKey: string;
    text: string;
    voiceStyle: "energetic";
    sourceEventId?: string;
    failureMode?: "visible_retry" | "quiet";
  },
): TwinRuntimeState {
  if (hasProcessedEvent(state, event.eventId)) {
    return state;
  }

  if (
    state.status === "failed" &&
    state.eventId === event.eventId &&
    state.retryable
  ) {
    return {
      status: "preparing_speech",
      eventId: event.eventId,
      dedupeKey: event.dedupeKey,
      text: event.text,
      voiceStyle: event.voiceStyle,
      sourceEventId: event.sourceEventId,
      failureMode: event.failureMode,
      processedEventIds: state.processedEventIds,
    };
  }

  if (isActiveRuntimeEvent(state, event.eventId)) {
    return state;
  }

  return {
    status: "preparing_speech",
    eventId: event.eventId,
    dedupeKey: event.dedupeKey,
    text: event.text,
    voiceStyle: event.voiceStyle,
    sourceEventId: event.sourceEventId,
    failureMode: event.failureMode,
    processedEventIds: state.processedEventIds,
  };
}

function applySpeechChunk(
  state: TwinRuntimeState,
  event: Extract<TwinRuntimeEvent, { type: "speech.audio_chunk" }>,
): TwinRuntimeState {
  if (hasProcessedEvent(state, event.eventId)) {
    return state;
  }

  if (state.status === "speaking" && state.eventId === event.eventId) {
    return { ...state, clips: [...state.clips, event.audioUrl] };
  }

  return {
    status: "speaking",
    eventId: event.eventId,
    dedupeKey: event.dedupeKey,
    text: "",
    clips: [event.audioUrl],
    clipCursor: 0,
    streamClosed: false,
    sourceEventId: event.sourceEventId,
    processedEventIds: state.processedEventIds,
  };
}

function resolveSpeechFailureMode(
  state: TwinRuntimeState,
  action: Extract<TwinRuntimeAction, { type: "speech.failed" }>,
) {
  if (action.failureMode) {
    return action.failureMode;
  }

  return "failureMode" in state ? state.failureMode ?? "visible_retry" : "visible_retry";
}

function hasProcessedEvent(state: TwinRuntimeState, eventId: string) {
  return state.processedEventIds.includes(eventId);
}

function isActiveRuntimeEvent(state: TwinRuntimeState, eventId: string) {
  return "eventId" in state && state.eventId === eventId;
}

function markProcessed(processedEventIds: string[], eventId: string) {
  return Array.from(new Set([...processedEventIds, eventId])).slice(-50);
}
