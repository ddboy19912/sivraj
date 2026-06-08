import type { useOnboardingFlow } from "@/hooks/onboarding/useOnboardingFlow";
import type { Session } from "@/lib/session";
import type { TwinRuntimeEvent } from "@/types/twin.types";

export type OnboardingFlow = ReturnType<typeof useOnboardingFlow>;

export type OnboardingStepViewProps = {
  flow: OnboardingFlow;
};

export const ONBOARDING_STEP_ORDER: ActiveOnboardingStep[] = [
  "name",
  "arrival",
  "identity",
];

export type RecorderState =
  | "idle"
  | "requesting"
  | "recording"
  | "recorded"
  | "saving";

export type OnboardingSaveStage =
  | "idle"
  | "encrypting"
  | "storing_memory"
  | "finishing_profile"
  | "complete";

type FormState = {
  twinNameInput: string;
  displayName: string;
  alias: string;
  firstMemory: string;
};

export type OnboardingState = {
  phase: OnboardingPhase;
  session: Session | null;
  hasCompletionHint: boolean;
  activeStep: ActiveOnboardingStep;
  twinProfile: TwinProfile | null;
  identityProfile: TwinIdentityProfile | null;
  voicePresets: VoicePreset[];
  defaultVoiceId: string;
  selectedVoiceId: string;
  previewingVoiceId: string | null;
  form: FormState;
  greeting: string;
  greetingAudioUrl: string | null;
  greetingAudioFailed: boolean;
  firstMeetIntroStatus: FirstMeetIntroStatus;
  firstMeetIntroActive: boolean;
  runtimeEvents: TwinRuntimeEvent[];
  isBusy: boolean;
  saveStage: OnboardingSaveStage;
  firstMemoryArtifactId: string | null;
  error: string | null;
  recorderState: RecorderState;
  recordingSeconds: number;
  recordedBlob: Blob | null;
  recordingPreviewUrl: string | null;
  cloneConsent: boolean;
};

type LoadedProfile = {
  profile: TwinProfile;
  identity: TwinIdentityProfile | null;
  voiceResponse: VoicePresetResponse | null;
};

export type OnboardingAction =
  | { type: "BEGIN" }
  | { type: "BUSY"; value: boolean }
  | { type: "SAVE_STAGE"; stage: OnboardingSaveStage }
  | { type: "FIRST_MEMORY_STORED"; artifactId: string }
  | { type: "ERROR"; message: string | null }
  | { type: "SESSION_REFRESHED"; session: Session }
  | { type: "SIGNED_IN"; session: Session }
  | { type: "SIGNING_STARTED" }
  | { type: "SIGNING_FAILED"; message: string }
  | { type: "NO_WALLET" }
  | { type: "WALLET_NEEDS_SIGNATURE"; hasCompletionHint: boolean }
  | { type: "ACTIVE_SESSION_CLEARED"; hasCompletionHint: boolean }
  | { type: "RESET_SESSION" }
  | { type: "PROFILE_LOADING" }
  | { type: "PROFILE_FAILED" }
  | { type: "PROFILE_LOADED"; payload: LoadedProfile }
  | { type: "TWIN_PROFILE_SAVED"; profile: TwinProfile }
  | { type: "IDENTITY_PROFILE_SAVED"; profile: TwinIdentityProfile }
  | { type: "STEP_CHANGED"; step: ActiveOnboardingStep }
  | { type: "SET_TWIN_NAME"; value: string }
  | { type: "SET_DISPLAY_NAME"; value: string }
  | { type: "SET_ALIAS"; value: string }
  | { type: "SET_FIRST_MEMORY"; value: string }
  | { type: "SET_SELECTED_VOICE"; voiceId: string }
  | { type: "VOICE_PREVIEW_STARTED"; voiceId: string }
  | { type: "VOICE_PREVIEW_ENDED" }
  | { type: "SET_CLONE_CONSENT"; value: boolean }
  | { type: "RECORDER_STATE"; value: RecorderState }
  | { type: "RECORDING_TICK"; seconds: number }
  | { type: "RECORDING_READY"; blob: Blob; previewUrl: string }
  | { type: "RECORDING_CLEARED" }
  | { type: "GREETING_READY"; text: string; audioUrl: string | null }
  | { type: "GREETING_FAILED"; text: string };

export type ActiveOnboardingStep =
  | "intro"
  | "connect"
  | "name"
  | "arrival"
  | "identity";

export type OnboardingPhase =
  | "booting"
  | "no_wallet"
  | "needs_wallet_signature"
  | "signing"
  | "loading_profile"
  | "ready_onboarding"
  | "ready_completed"
  | "auth_error";

export type TwinProfile = {
  twinId: string;
  name: string;
};

export type TwinIdentityProfile = {
  twinId: string;
  displayName: string | null;
  aliases: string[];
  emails: string[];
  phones: string[];
  handles: Record<string, string[]>;
  selfDescriptionArtifactId: string | null;
  onboardingStatus: "not_started" | "in_progress" | "completed";
  firstMeetIntroStatus: FirstMeetIntroStatus;
  shouldPlayFirstMeetIntro: boolean;
  events: TwinRuntimeEvent[];
};

export type FirstMeetIntroStatus = "not_started" | "issued" | "consumed";

export type VoicePreset = {
  id: string;
  name: string;
  description: string;
};

export type VoicePresetResponse = {
  defaultVoiceId: string;
  presets: VoicePreset[];
};

export type ArtifactReceipt = {
  artifactId: string;
};

export type VerifyResponse = Session & {
  userId: string;
};

export type ChallengeResponse = {
  message: string;
  challengeToken: string;
};
