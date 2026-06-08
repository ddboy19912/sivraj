import type { ComponentType } from "react";
import type {
  ActiveOnboardingStep,
  OnboardingStepViewProps,
} from "@/types/onboarding.types";
import { ArrivalStep } from "@/pages/onboarding/steps/ArrivalStep";
import { ConnectStep } from "@/pages/onboarding/steps/ConnectStep";
import { IdentityStep } from "@/pages/onboarding/steps/IdentityStep";
import { IntroStep } from "@/pages/onboarding/steps/IntroStep";
import { NameStep } from "@/pages/onboarding/steps/NameStep";

export const onboardingStepViews: Record<
  ActiveOnboardingStep,
  ComponentType<OnboardingStepViewProps>
> = {
  intro: IntroStep,
  connect: ConnectStep,
  name: NameStep,
  arrival: ArrivalStep,
  identity: IdentityStep,
};

export function shouldShowOnboardingTimeline(step: ActiveOnboardingStep) {
  return step !== "intro";
}
