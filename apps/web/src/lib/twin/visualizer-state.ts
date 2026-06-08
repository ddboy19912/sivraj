import type { AgentState } from "@livekit/components-react";
import type { NavigationTabId } from "@/components/navigation/NavigationTab";
import type { OnboardingFlow } from "@/types/onboarding.types";
import { getAgentState } from "@/lib/twin/runtime-selectors";
import type { TwinRuntimeState } from "@/types/twin.types";

export type TwinVisualizerSignals = {
  activeTab: NavigationTabId;
  onboarding: Pick<
    OnboardingFlow,
    | "currentStep"
    | "isBusy"
    | "onboardingComplete"
    | "accessState"
    | "completedOnboardingHint"
  >;
  runtimeState: TwinRuntimeState;
};

export function getHomeAgentState({
  activeTab,
  onboarding,
  runtimeState,
}: TwinVisualizerSignals): AgentState | null {
  if (activeTab !== "home") {
    return null;
  }

  const runtimeAgentState = getAgentState(runtimeState);
  if (runtimeAgentState !== "idle") {
    return runtimeAgentState;
  }

  if (onboarding.accessState.status !== "app_ready") {
    return "idle";
  }

  if (onboarding.isBusy) {
    return "thinking";
  }

  return "idle";
}
