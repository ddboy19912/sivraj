import type { AgentAudioSnapshot } from "@/types/agent-audio.types";
import { createContext, use } from "react";

export type AgentAudioContextValue = AgentAudioSnapshot;

export const AgentAudioContext = createContext<AgentAudioContextValue | null>(
  null,
);

export function useAgentAudio(): AgentAudioContextValue {
  const context = use(AgentAudioContext);

  if (!context) {
    throw new Error("useAgentAudio must be used within AgentAudioProvider");
  }

  return context;
}
