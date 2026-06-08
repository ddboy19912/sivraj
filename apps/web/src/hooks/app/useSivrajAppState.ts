import { useState } from "react";
import type { ProviderConfigResponse } from "@/lib/chat/chat-api";
import type { NavigationTabId } from "@/components/navigation/NavigationTab";
import { useOnboardingFlow } from "@/hooks/onboarding/useOnboardingFlow";
import { useTwinRuntime } from "@/hooks/twin-runtime/useTwinRuntime";
import { getAppOverlay } from "@/lib/app/overlay";
import { getProviderNavStatus } from "@/lib/navigation/provider-status";
import {
  getHomeAgentState,
} from "@/lib/twin/visualizer-state";
import { getStatusHud } from "@/lib/twin/runtime-selectors";
import { useSivrajAppStore } from "@/stores/sivraj-app";

export function useSivrajAppState(activeTab: NavigationTabId) {
  const { providerOpen, settingsOpen, setProviderOpen, setSettingsOpen } =
    useSivrajAppStore();
  const [providerState, setProviderState] =
    useState<ProviderConfigResponse | null>(null);
  const onboarding = useOnboardingFlow();
  const twinRuntime = useTwinRuntime({
    events: onboarding.runtimeEvents,
    session: onboarding.session,
    setSession: onboarding.setSession,
  });

  const visualTab = activeTab === "settings" ? "home" : activeTab;
  const homeAgentState =
    getHomeAgentState({
      activeTab: visualTab,
      onboarding,
      runtimeState: twinRuntime.runtimeState,
    }) ?? "initializing";
  const homeStatusHud = getStatusHud(twinRuntime.runtimeState);

  return {
    activeTab,
    appOverlay: getAppOverlay(onboarding.accessState),
    homeAgentState,
    homeStatusHud,
    onboarding,
    providerOpen,
    providerState,
    providerStatus: getProviderNavStatus(providerState),
    setProviderOpen,
    setProviderState,
    setSettingsOpen,
    settingsOpen,
    twinRuntime,
  };
}
