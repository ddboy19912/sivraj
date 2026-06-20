export type VoicePushToTalkMode = "toggle";

export type VoicePreset = {
  id: string;
  name: string;
  description: string;
};

export type VoicePresetResponse = {
  defaultVoiceId: string;
  presets: VoicePreset[];
};

export type VoiceSettings = {
  twinId: string;
  wakeEnabled: boolean;
  wakePhrase: string;
  defaultWakePhrase: string;
  wakePhraseIsDefault: boolean;
  pushToTalkMode: VoicePushToTalkMode;
  metadata: Record<string, unknown>;
  createdAt: string | null;
  updatedAt: string | null;
};

export type TwinVoiceProfile = {
  twinId: string;
  mode: "preset" | "clone";
  presetVoiceId: string;
  provider: string;
  referenceArtifactId: string | null;
  consentAt: string | null;
  metadata: Record<string, unknown>;
};

export type VoiceTranscription = {
  text: string;
  provider: string;
  model: string;
  metadata: Record<string, unknown>;
};

export type RealtimeVoiceTranscriptionSession = {
  provider: "cartesia";
  accessToken: string;
  expiresIn: number;
  websocketUrl: string;
  model: string;
  encoding: "pcm_s16le";
  sampleRate: number;
  apiVersion: string;
};

export type RealtimeVoiceSynthesisSession = {
  provider: "cartesia";
  accessToken: string;
  expiresIn: number;
  websocketUrl: string;
  model: string;
  voiceId: string;
  language: string;
  encoding: "pcm_s16le";
  sampleRate: number;
  apiVersion: string;
};

export type HomepageVoicePhase =
  | "idle"
  | "requesting_permission"
  | "recording_push_to_talk"
  | "armed_wake"
  | "wake_detected"
  | "transcribing"
  | "thinking"
  | "speaking"
  | "interrupted"
  | "failed"
  | "unsupported";

export type HomepageVoiceState = {
  phase: HomepageVoicePhase;
  activeEventId: string | null;
  activeThreadId: string | null;
  settings: VoiceSettings | null;
  settingsStatus: "idle" | "loading" | "ready" | "saving" | "failed";
  profile: TwinVoiceProfile | null;
  userTranscript: string | null;
  assistantTranscript: string | null;
  partialAssistantTranscript: string;
  error: string | null;
  wakeSupported: boolean;
};
