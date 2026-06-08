import { normalizeTwinName } from '@/lib/onboarding/flow-selectors'
import type {
  OnboardingAction,
  OnboardingState,
} from '@/types/onboarding.types'
import type { TwinIdentityProfile } from '@/types/onboarding.types'

type LoadedProfile = Extract<
  OnboardingAction,
  { type: 'PROFILE_LOADED' }
>['payload']

type FormState = OnboardingState['form']

function resolveLoadedProfilePhase(
  identity: TwinIdentityProfile | null,
  hasNamedTwin: boolean,
): Pick<OnboardingState, 'phase' | 'hasCompletionHint' | 'activeStep'> {
  const isComplete = identity?.onboardingStatus === 'completed' && hasNamedTwin

  return {
    phase: isComplete ? 'ready_completed' : 'ready_onboarding',
    hasCompletionHint: isComplete,
    activeStep: hasNamedTwin ? 'arrival' : 'name',
  }
}

function buildLoadedProfileForm(
  state: OnboardingState,
  twinNameInput: string,
  identity: TwinIdentityProfile | null,
): FormState {
  return {
    ...state.form,
    twinNameInput,
    displayName: identity?.displayName ?? '',
    alias: identity?.aliases.join(', ') ?? '',
  }
}

function applyLoadedProfile(
  state: OnboardingState,
  { profile, identity, voiceResponse }: LoadedProfile,
): OnboardingState {
  const twinNameInput = normalizeTwinName(profile.name)
  const hasNamedTwin = Boolean(twinNameInput)

  return {
    ...state,
    ...resolveLoadedProfilePhase(identity, hasNamedTwin),
    twinProfile: profile,
    identityProfile: identity,
    voicePresets: voiceResponse?.presets ?? state.voicePresets,
    defaultVoiceId: voiceResponse?.defaultVoiceId ?? state.defaultVoiceId,
    selectedVoiceId: voiceResponse?.defaultVoiceId ?? state.selectedVoiceId,
    firstMeetIntroStatus: identity?.firstMeetIntroStatus ?? (
      identity?.onboardingStatus === 'completed' ? 'consumed' : state.firstMeetIntroStatus
    ),
    firstMeetIntroActive: false,
    runtimeEvents: identity?.events ?? [],
    firstMemoryArtifactId:
      identity?.selfDescriptionArtifactId ?? state.firstMemoryArtifactId,
    saveStage: 'idle',
    form: buildLoadedProfileForm(state, twinNameInput, identity),
    error: null,
  }
}

export function handleProfileLoadActions(
  state: OnboardingState,
  action: OnboardingAction,
): OnboardingState | null {
  switch (action.type) {
    case 'PROFILE_LOADING':
      return state.session
        ? { ...state, phase: 'loading_profile', error: null }
        : state
    case 'PROFILE_FAILED':
      if (!state.session) {
        return state
      }

      return state.hasCompletionHint
        ? { ...state, phase: 'ready_completed' }
        : { ...state, phase: 'auth_error' }
    case 'PROFILE_LOADED':
      return applyLoadedProfile(state, action.payload)
    default:
      return null
  }
}
