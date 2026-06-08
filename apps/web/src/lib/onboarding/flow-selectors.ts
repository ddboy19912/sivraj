import type { ActiveOnboardingStep } from "@/types/onboarding.types";
import {
  ONBOARDING_STEP_ORDER,
  type OnboardingState,
} from "@/types/onboarding.types";

const DEFAULT_TWIN_NAME = "Primary Twin";

export function normalizeTwinName(name: string | undefined): string {
  return name === DEFAULT_TWIN_NAME ? "" : (name ?? "");
}

export function twinNameFromState(state: OnboardingState) {
  return normalizeTwinName(state.twinProfile?.name);
}

export function getCurrentStep(
  state: OnboardingState,
): ActiveOnboardingStep | null {
  if (!shouldShowOnboardingPanel(state)) {
    return null;
  }

  return state.activeStep === "intro" || state.activeStep === "connect"
    ? "name"
    : state.activeStep;
}

export function getUnlockedStepIndex(
  state: OnboardingState,
  canUseProtectedApp: boolean,
) {
  if (!canUseProtectedApp) {
    return 0;
  }

  const activeIndex = ONBOARDING_STEP_ORDER.indexOf(state.activeStep);
  const twinNameIndex = twinNameFromState(state)
    ? ONBOARDING_STEP_ORDER.indexOf("arrival")
    : 0;
  const identityIndex =
    state.activeStep === "identity" || state.phase === "ready_completed"
      ? ONBOARDING_STEP_ORDER.indexOf("identity")
      : 0;

  return Math.max(
    0,
    Math.max(0, ONBOARDING_STEP_ORDER.indexOf("name")),
    activeIndex,
    twinNameIndex,
    identityIndex,
  );
}

export function isVerifiedOnboardingSession(
  state: OnboardingState,
  hasMatchingWalletSession: boolean,
) {
  return (
    hasMatchingWalletSession &&
    (state.phase === "ready_onboarding" || state.phase === "ready_completed")
  );
}

export function canUseProtectedApp(
  state: OnboardingState,
  hasMatchingWalletSession: boolean,
) {
  return (
    hasMatchingWalletSession &&
    (state.phase === "ready_completed" ||
      (state.phase === "loading_profile" && state.hasCompletionHint))
  );
}

export function hasCompletedOnboardingHint(state: OnboardingState) {
  return state.hasCompletionHint;
}

export function shouldShowOnboardingPanel(state: OnboardingState) {
  return state.phase === "ready_onboarding";
}

export function shouldShowWalletAuthGate(state: OnboardingState) {
  return (
    state.phase === "no_wallet" ||
    state.phase === "needs_wallet_signature" ||
    state.phase === "signing" ||
    state.phase === "auth_error"
  );
}
