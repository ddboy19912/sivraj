import type { AgentState, TrackReferenceOrPlaceholder } from "@livekit/components-react";
import type { LocalAudioTrack, RemoteAudioTrack } from "livekit-client";

export type AgentAudioTrack =
  | LocalAudioTrack
  | RemoteAudioTrack
  | TrackReferenceOrPlaceholder;

export type AgentAudioSource = "livekit" | "twin-speech" | "twin-runtime";

export type AgentAudioSnapshot = {
  state: AgentState;
  audioTrack?: AgentAudioTrack;
  source: AgentAudioSource;
};

export type LiveKitAgentAudioInput = {
  state: AgentState;
  audioTrack?: AgentAudioTrack;
};
