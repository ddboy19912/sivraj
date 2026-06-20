import type { AgentState } from "@livekit/components-react";
import type { AgentStatusHudState } from "@/components/ai/AgentStatusHud";
import type {
  SpeechPlaybackCommand,
  TwinRuntimeState,
} from "@/types/twin.types";

export function getAgentState(runtimeState: TwinRuntimeState): AgentState {
  switch (runtimeState.status) {
    case "preparing_speech":
    case "thinking":
      return "thinking";
    case "speaking":
      return "speaking";
    case "listening":
      return "listening";
    case "failed":
      return "failed";
    case "idle":
      return "idle";
  }
}

export function getStatusHud(
  runtimeState: TwinRuntimeState,
): AgentStatusHudState {
  switch (runtimeState.status) {
    case "preparing_speech":
    case "thinking":
      return {
        label: "AGENT_STATUS",
        status: "THINKING",
        active: true,
      };
    case "speaking":
      return {
        label: "AGENT_STATUS",
        status: "SPEAKING",
        active: true,
      };
    case "listening":
      return {
        label: "AGENT_STATUS",
        status: "LISTENING",
        active: true,
      };
    case "failed":
      return {
        label: "AGENT_STATUS",
        status: "VOICE_PENDING",
        active: false,
        progress: 18,
      };
    case "idle":
      return {
        label: "AGENT_STATUS",
        status: "IDLE",
        active: false,
        progress: 100,
      };
  }
}

export function getSpeechPlaybackCommand(
  runtimeState: TwinRuntimeState,
): SpeechPlaybackCommand {
  if (runtimeState.status !== "speaking") {
    return null;
  }

  const { clips, clipCursor, streamClosed, eventId } = runtimeState;
  const audioUrl = clips[clipCursor];
  if (!audioUrl) {
    // Buffering: the next clip in the stream has not arrived yet.
    return null;
  }

  return {
    eventId,
    clipId: `${eventId}#${clipCursor}`,
    audioUrl,
    isFinalClip: streamClosed && clipCursor === clips.length - 1,
  };
}
