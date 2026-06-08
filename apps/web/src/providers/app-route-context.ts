import type { AgentState } from "@livekit/components-react";
import { createContext, use } from "react";
import type { AgentStatusHudState } from "@/components/ai/AgentStatusHud";
import type { ProviderConfigResponse } from "@/lib/chat/chat-api";
import type { OnboardingFlow } from "@/types/onboarding.types";

export type AppRouteContextValue = {
  homeAgentState: AgentState;
  homeStatusHud: AgentStatusHudState;
  onboarding: OnboardingFlow;
  providerState: ProviderConfigResponse | null;
  setProviderOpen: (open: boolean) => void;
  setProviderState: (state: ProviderConfigResponse | null) => void;
};

export const AppRouteContext = createContext<AppRouteContextValue | null>(null);

export function useAppRouteContext(): AppRouteContextValue {
  const context = use(AppRouteContext);

  if (!context) {
    throw new Error("useAppRouteContext must be used within AppRouteContext");
  }

  return context;
}
