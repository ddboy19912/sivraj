import type { Session } from '@/lib/session'
import type { OnboardingState } from '@/types/onboarding.types'

const DEFAULT_VOICE_ID = 'warm_operator'

const initialFormState: OnboardingState['form'] = {
  twinNameInput: '',
  displayName: '',
  alias: '',
  firstMemory: '',
}

export function createInitialState(
  session: Session | null,
  hasCompletedOnboarding = false,
): OnboardingState {
  return {
    phase: hasCompletedOnboarding
      ? 'ready_completed'
      : session
        ? 'booting'
        : 'no_wallet',
    session,
    hasCompletionHint: hasCompletedOnboarding,
    activeStep: 'name',
    twinProfile: null,
    identityProfile: null,
    voicePresets: [],
    defaultVoiceId: DEFAULT_VOICE_ID,
    selectedVoiceId: DEFAULT_VOICE_ID,
    previewingVoiceId: null,
    form: initialFormState,
    greeting: '',
    greetingAudioUrl: null,
    greetingAudioFailed: false,
    firstMeetIntroStatus: hasCompletedOnboarding ? 'consumed' : 'not_started',
    firstMeetIntroActive: false,
    runtimeEvents: [],
    isBusy: false,
    saveStage: 'idle',
    firstMemoryArtifactId: null,
    error: null,
    recorderState: 'idle',
    recordingSeconds: 0,
    recordedBlob: null,
    recordingPreviewUrl: null,
    cloneConsent: false,
  }
}
