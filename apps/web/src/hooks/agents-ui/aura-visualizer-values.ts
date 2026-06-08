import type { AgentState } from "@livekit/components-react";

export const AURA_VISUALIZER_DEFAULTS = {
  speed: 10,
  amplitude: 2,
  frequency: 0.5,
  scale: 0.2,
  brightness: 1.5,
} as const;

export type AuraVisualizerValues = {
  speed: number;
  amplitude: number;
  frequency: number;
  scale: number;
  brightness: number;
};

export function resolveAuraVisualizerValues(
  state: AgentState | undefined,
  volume: number,
): AuraVisualizerValues {
  switch (state) {
    case "idle":
    case "failed":
    case "disconnected":
      return {
        speed: 10,
        scale: 0.2,
        amplitude: 1.2,
        frequency: 0.4,
        brightness: 1,
      };
    case "listening":
    case "pre-connect-buffering":
      return {
        speed: 20,
        scale: 0.3,
        amplitude: 1,
        frequency: 0.7,
        brightness: 1.8,
      };
    case "thinking":
    case "connecting":
    case "initializing":
      return {
        speed: 30,
        scale: 0.3,
        amplitude: 0.5,
        frequency: 1,
        brightness: 1.9,
      };
    case "speaking":
      return {
        speed: 70,
        scale: 0.22 + 0.18 * volume,
        amplitude: 0.75,
        frequency: 1.25,
        brightness: 1.5 + volume,
      };
    default:
      return { ...AURA_VISUALIZER_DEFAULTS };
  }
}
