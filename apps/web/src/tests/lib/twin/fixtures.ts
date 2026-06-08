import type { TwinVisualizerSignals } from "@/lib/twin/visualizer-state";
import { createInitialTwinRuntimeState } from "@/lib/twin/runtime-reducer";
import { createBootstrap } from "@/tests/fixtures/onboarding-fixtures";

export function homeSignals(overrides: Partial<TwinVisualizerSignals> = {}): TwinVisualizerSignals {
  return {
    activeTab: "home",
    runtimeState: createInitialTwinRuntimeState(),
    onboarding: {
      currentStep: null,
      isBusy: false,
      onboardingComplete: true,
      completedOnboardingHint: true,
      accessState: { status: "app_ready", bootstrap: createBootstrap("completed") },
    },
    ...overrides,
  };
}
