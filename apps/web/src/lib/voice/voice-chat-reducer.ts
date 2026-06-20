import type {
  HomepageVoiceState,
  TwinVoiceProfile,
  VoiceSettings,
} from "@/types/voice.types";

export type HomepageVoiceAction =
  | { type: "WAKE_SUPPORT_RESOLVED"; supported: boolean }
  | { type: "SETTINGS_LOADING" }
  | {
      type: "SETTINGS_READY";
      settings: VoiceSettings;
      profile: TwinVoiceProfile | null;
    }
  | { type: "SETTINGS_SAVING" }
  | { type: "SETTINGS_FAILED"; error: string }
  | { type: "SETTINGS_UPDATED"; settings: VoiceSettings }
  | { type: "PERMISSION_REQUESTED"; eventId: string }
  | { type: "RECORDING_STARTED"; eventId: string }
  | { type: "WAKE_ARMED" }
  | { type: "WAKE_DETECTED"; eventId: string }
  | { type: "TRANSCRIBING"; eventId: string }
  | { type: "USER_TRANSCRIPT_UPDATED"; eventId: string; text: string }
  | { type: "TRANSCRIPT_READY"; eventId: string; text: string }
  | { type: "THINKING"; eventId: string }
  | { type: "ASSISTANT_DELTA"; eventId: string; delta: string }
  | {
      type: "ASSISTANT_READY";
      eventId: string;
      text: string;
      threadId: string | null;
    }
  | { type: "SPEAKING"; eventId: string }
  | { type: "SPEECH_ENDED" }
  | { type: "INTERRUPTED"; eventId: string }
  | { type: "FAILED"; eventId?: string; error: string }
  | { type: "UNSUPPORTED"; error: string }
  | { type: "RESET_ERROR" }
  | { type: "IDLE" };

export function createInitialHomepageVoiceState(): HomepageVoiceState {
  return {
    phase: "idle",
    activeEventId: null,
    activeThreadId: null,
    settings: null,
    settingsStatus: "idle",
    profile: null,
    userTranscript: null,
    assistantTranscript: null,
    partialAssistantTranscript: "",
    error: null,
    wakeSupported: false,
  };
}

export function homepageVoiceReducer(
  state: HomepageVoiceState,
  action: HomepageVoiceAction,
): HomepageVoiceState {
  switch (action.type) {
    case "WAKE_SUPPORT_RESOLVED":
      return { ...state, wakeSupported: action.supported };
    case "SETTINGS_LOADING":
      return { ...state, settingsStatus: "loading", error: null };
    case "SETTINGS_READY":
      return {
        ...state,
        settings: action.settings,
        profile: action.profile,
        settingsStatus: "ready",
        phase: resolveSettingsReadyPhase(state, action.settings),
        error: state.phase === "idle" || state.phase === "armed_wake" ? null : state.error,
      };
    case "SETTINGS_SAVING":
      return { ...state, settingsStatus: "saving", error: null };
    case "SETTINGS_UPDATED":
      return {
        ...state,
        settings: action.settings,
        settingsStatus: "ready",
        phase: state.phase === "idle" || state.phase === "armed_wake"
          ? resolveIdleVoicePhase(action.settings.wakeEnabled, state.wakeSupported)
          : state.phase,
        error: null,
      };
    case "SETTINGS_FAILED":
      return {
        ...state,
        settingsStatus: "failed",
        error: action.error,
      };
    case "PERMISSION_REQUESTED":
      return {
        ...state,
        phase: "requesting_permission",
        activeEventId: action.eventId,
        userTranscript: null,
        assistantTranscript: null,
        partialAssistantTranscript: "",
        error: null,
      };
    case "RECORDING_STARTED":
      return {
        ...state,
        phase: "recording_push_to_talk",
        activeEventId: action.eventId,
        userTranscript: null,
        assistantTranscript: null,
        partialAssistantTranscript: "",
        error: null,
      };
    case "WAKE_ARMED":
      return state.phase === "idle"
        ? { ...state, phase: "armed_wake", error: null }
        : state;
    case "WAKE_DETECTED":
      return {
        ...state,
        phase: "wake_detected",
        activeEventId: action.eventId,
        error: null,
      };
    case "TRANSCRIBING":
      if (!isActiveEvent(state, action.eventId)) {
        return state;
      }
      return { ...state, phase: "transcribing", error: null };
    case "USER_TRANSCRIPT_UPDATED":
      if (!isActiveEvent(state, action.eventId)) {
        return state;
      }
      return {
        ...state,
        userTranscript: action.text,
        assistantTranscript: null,
        partialAssistantTranscript: "",
      };
    case "TRANSCRIPT_READY":
      if (!isActiveEvent(state, action.eventId)) {
        return state;
      }
      return {
        ...state,
        userTranscript: action.text,
        assistantTranscript: null,
        partialAssistantTranscript: "",
      };
    case "THINKING":
      if (!isActiveEvent(state, action.eventId)) {
        return state;
      }
      return { ...state, phase: "thinking", error: null };
    case "ASSISTANT_DELTA":
      if (!isActiveEvent(state, action.eventId)) {
        return state;
      }
      return {
        ...state,
        partialAssistantTranscript: `${state.partialAssistantTranscript}${action.delta}`,
      };
    case "ASSISTANT_READY":
      if (!isActiveEvent(state, action.eventId)) {
        return state;
      }
      return {
        ...state,
        activeThreadId: action.threadId ?? state.activeThreadId,
        assistantTranscript: action.text,
        partialAssistantTranscript: "",
      };
    case "SPEAKING":
      if (!isActiveEvent(state, action.eventId)) {
        return state;
      }
      return { ...state, phase: "speaking", error: null };
    case "SPEECH_ENDED":
      return {
        ...state,
        phase: resolveIdleVoicePhase(state.settings?.wakeEnabled ?? false, state.wakeSupported),
        activeEventId: null,
      };
    case "INTERRUPTED":
      return {
        ...state,
        phase: "interrupted",
        activeEventId: action.eventId,
        error: null,
      };
    case "FAILED":
      if (action.eventId && !isActiveEvent(state, action.eventId)) {
        return state;
      }
      return {
        ...state,
        phase: "failed",
        activeEventId: null,
        partialAssistantTranscript: "",
        error: action.error,
      };
    case "UNSUPPORTED":
      return {
        ...state,
        phase: "unsupported",
        activeEventId: null,
        error: action.error,
      };
    case "RESET_ERROR":
      return { ...state, error: null };
    case "IDLE":
      return {
        ...state,
        phase: resolveIdleVoicePhase(state.settings?.wakeEnabled ?? false, state.wakeSupported),
        activeEventId: null,
        error: null,
      };
  }
}

function isActiveEvent(state: HomepageVoiceState, eventId: string) {
  return state.activeEventId === eventId;
}

function resolveIdleVoicePhase(wakeEnabled: boolean, wakeSupported: boolean) {
  return wakeEnabled && wakeSupported ? "armed_wake" : "idle";
}

function resolveSettingsReadyPhase(
  state: HomepageVoiceState,
  settings: VoiceSettings,
) {
  return state.phase === "idle" || state.phase === "armed_wake"
    ? resolveIdleVoicePhase(settings.wakeEnabled, state.wakeSupported)
    : state.phase;
}
