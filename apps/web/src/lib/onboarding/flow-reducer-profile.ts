import { handleProfileLoadActions } from '@/lib/onboarding/flow-reducer-profile-load'
import { handleProfileSaveActions } from '@/lib/onboarding/flow-reducer-profile-save'
import type {
  OnboardingAction,
  OnboardingState,
} from '@/types/onboarding.types'

export function handleProfileActions(
  state: OnboardingState,
  action: OnboardingAction,
): OnboardingState | null {
  return (
    handleProfileLoadActions(state, action) ??
    handleProfileSaveActions(state, action)
  )
}
