import type {
  OnboardingAction,
  OnboardingState,
} from '@/types/onboarding.types'

type FormState = OnboardingState['form']

function updateFormField(
  state: OnboardingState,
  field: keyof FormState,
  value: string,
): OnboardingState {
  return { ...state, form: { ...state.form, [field]: value } }
}

function handleFormFieldActions(
  state: OnboardingState,
  action: OnboardingAction,
): OnboardingState | null {
  switch (action.type) {
    case 'STEP_CHANGED':
      return { ...state, activeStep: action.step }
    case 'SET_TWIN_NAME':
      return updateFormField(state, 'twinNameInput', action.value)
    case 'SET_DISPLAY_NAME':
      return updateFormField(state, 'displayName', action.value)
    case 'SET_ALIAS':
      return updateFormField(state, 'alias', action.value)
    case 'SET_FIRST_MEMORY':
      return {
        ...updateFormField(state, 'firstMemory', action.value),
        firstMemoryArtifactId: null,
        saveStage: state.saveStage === 'complete' ? 'idle' : state.saveStage,
      }
    default:
      return null
  }
}

function handleVoiceAndGreetingActions(
  state: OnboardingState,
  action: OnboardingAction,
): OnboardingState | null {
  switch (action.type) {
    case 'SET_SELECTED_VOICE':
      return { ...state, selectedVoiceId: action.voiceId }
    case 'VOICE_PREVIEW_STARTED':
      return {
        ...state,
        selectedVoiceId: action.voiceId,
        previewingVoiceId: action.voiceId,
        error: null,
      }
    case 'VOICE_PREVIEW_ENDED':
      return { ...state, previewingVoiceId: null }
    case 'SET_CLONE_CONSENT':
      return { ...state, cloneConsent: action.value }
    case 'GREETING_READY':
      return {
        ...state,
        greeting: action.text,
        greetingAudioUrl: action.audioUrl,
        greetingAudioFailed: false,
      }
    case 'GREETING_FAILED':
      return {
        ...state,
        greeting: action.text,
        greetingAudioUrl: null,
        greetingAudioFailed: true,
      }
    default:
      return null
  }
}

export function handleFormActions(
  state: OnboardingState,
  action: OnboardingAction,
): OnboardingState | null {
  return (
    handleFormFieldActions(state, action) ??
    handleVoiceAndGreetingActions(state, action)
  )
}
