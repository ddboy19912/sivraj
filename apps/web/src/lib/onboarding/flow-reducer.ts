import { handleAuthActions } from '@/lib/onboarding/flow-reducer-auth'
import { handleFormActions } from '@/lib/onboarding/flow-reducer-form'
import { handleProfileActions } from '@/lib/onboarding/flow-reducer-profile'
import { handleRecorderActions } from '@/lib/onboarding/flow-reducer-recorder'
import { handleStatusActions } from '@/lib/onboarding/flow-reducer-status'
import type {
  OnboardingAction,
  OnboardingState,
} from '@/types/onboarding.types'

export { createInitialState } from '@/lib/onboarding/flow-reducer-initial'

export function onboardingReducer(
  state: OnboardingState,
  action: OnboardingAction,
): OnboardingState {
  return (
    handleStatusActions(state, action) ??
    handleAuthActions(state, action) ??
    handleProfileActions(state, action) ??
    handleFormActions(state, action) ??
    handleRecorderActions(state, action) ??
    state
  )
}
