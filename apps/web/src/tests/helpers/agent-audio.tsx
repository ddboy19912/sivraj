import type { ReactNode } from "react";
import type { AgentState } from "@livekit/components-react";
import { AgentAudioContext } from "@/providers/agent-audio-context";
import type { AgentAudioSnapshot } from "@/types/agent-audio.types";

type AgentAudioTestProviderProps = {
  value?: Partial<AgentAudioSnapshot>;
  children: ReactNode;
};

export function AgentAudioTestProvider({
  value,
  children,
}: AgentAudioTestProviderProps) {
  const snapshot: AgentAudioSnapshot = {
    state: value?.state ?? ("idle" as AgentState),
    audioTrack: value?.audioTrack,
    source: value?.source ?? "twin-runtime",
  };

  return (
    <AgentAudioContext value={snapshot}>
      {children}
    </AgentAudioContext>
  );
}
