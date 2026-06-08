import { createInitialState } from '@/lib/onboarding/flow-reducer-initial'
import type {
  OnboardingAction,
  OnboardingState,
} from '@/types/onboarding.types'

function handleAuthSessionActions(
  state: OnboardingState,
  action: OnboardingAction,
): OnboardingState | null {
  switch (action.type) {
    case 'BEGIN':
      return state.session
        ? { ...state, phase: 'ready_onboarding', activeStep: 'name' }
        : { ...state, phase: 'needs_wallet_signature', activeStep: 'name' }
    case 'SESSION_REFRESHED':
      return { ...state, session: action.session }
    case 'SIGNING_STARTED':
      return { ...state, phase: 'signing', isBusy: true, error: null }
    case 'SIGNED_IN':
      return {
        ...state,
        session: action.session,
        hasCompletionHint: false,
        phase: 'loading_profile',
        activeStep: 'name',
        isBusy: false,
        error: null,
      }
    case 'SIGNING_FAILED':
      return { ...state, phase: 'auth_error', isBusy: false, error: action.message }
    default:
      return null
  }
}

function handleAuthWalletActions(
  state: OnboardingState,
  action: OnboardingAction,
): OnboardingState | null {
  switch (action.type) {
    case 'NO_WALLET':
      return {
        ...state,
        session: null,
        hasCompletionHint: false,
        phase: 'no_wallet',
        isBusy: false,
        error: null,
      }
    case 'WALLET_NEEDS_SIGNATURE':
      return {
        ...state,
        session: null,
        hasCompletionHint: action.hasCompletionHint,
        phase: 'needs_wallet_signature',
        activeStep: 'name',
        twinProfile: null,
        identityProfile: null,
        isBusy: false,
        saveStage: 'idle',
        firstMemoryArtifactId: null,
        error: null,
      }
    case 'ACTIVE_SESSION_CLEARED':
      return {
        ...state,
        session: null,
        hasCompletionHint: action.hasCompletionHint,
        phase: 'needs_wallet_signature',
        isBusy: false,
        error: null,
      }
    case 'RESET_SESSION':
      return { ...createInitialState(null), phase: 'no_wallet' }
    default:
      return null
  }
}

export function handleAuthActions(
  state: OnboardingState,
  action: OnboardingAction,
): OnboardingState | null {
  return (
    handleAuthSessionActions(state, action) ??
    handleAuthWalletActions(state, action)
  )
}
