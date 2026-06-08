import { normalizeTwinName } from '@/lib/onboarding/flow-selectors'
import type {
  OnboardingAction,
  OnboardingState,
} from '@/types/onboarding.types'
import type { TwinIdentityProfile } from '@/types/onboarding.types'

function completeOnboardingState(
  state: OnboardingState,
  profile: TwinIdentityProfile,
): OnboardingState {
  return {
    ...state,
    identityProfile: profile,
    hasCompletionHint: true,
    phase: 'ready_completed',
    activeStep: 'identity',
    saveStage: 'complete',
    firstMeetIntroStatus: profile.firstMeetIntroStatus,
    firstMeetIntroActive: false,
    runtimeEvents: profile.events,
  }
}

export function handleProfileSaveActions(
  state: OnboardingState,
  action: OnboardingAction,
): OnboardingState | null {
  switch (action.type) {
    case 'TWIN_PROFILE_SAVED':
      return {
        ...state,
        twinProfile: action.profile,
        activeStep: 'arrival',
        phase: 'ready_onboarding',
        form: {
          ...state.form,
          twinNameInput: normalizeTwinName(action.profile.name),
        },
      }
    case 'IDENTITY_PROFILE_SAVED':
      return {
        ...completeOnboardingState(state, action.profile),
        greeting: '',
        greetingAudioUrl: null,
        greetingAudioFailed: false,
      }
    default:
      return null
  }
}
