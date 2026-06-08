import type {
  OnboardingAction,
  OnboardingState,
} from '@/types/onboarding.types'

export function handleStatusActions(
  state: OnboardingState,
  action: OnboardingAction,
): OnboardingState | null {
  switch (action.type) {
    case 'BUSY':
      return { ...state, isBusy: action.value }
    case 'SAVE_STAGE':
      return { ...state, saveStage: action.stage }
    case 'FIRST_MEMORY_STORED':
      return { ...state, firstMemoryArtifactId: action.artifactId }
    case 'ERROR':
      return { ...state, error: action.message }
    default:
      return null
  }
}
