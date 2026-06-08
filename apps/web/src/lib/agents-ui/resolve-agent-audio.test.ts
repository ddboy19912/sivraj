import { describe, expect, it } from "vitest";
import { resolveAgentAudio } from "@/lib/agents-ui/resolve-agent-audio";

describe("resolveAgentAudio", () => {
  it("prefers livekit state and audio track when a session is active", () => {
    expect(
      resolveAgentAudio({
        fallbackState: "initializing",
        liveKit: { state: "listening", audioTrack: { kind: "audio" } as never },
        speechCommand: { eventId: "event-1", audioUrl: "blob:audio" },
        twinSpeechTrack: { kind: "audio" } as never,
      }),
    ).toEqual({
      state: "listening",
      audioTrack: { kind: "audio" },
      source: "livekit",
    });
  });

  it("uses twin speech audio while intro playback is active", () => {
    expect(
      resolveAgentAudio({
        fallbackState: "initializing",
        liveKit: null,
        speechCommand: { eventId: "event-1", audioUrl: "blob:audio" },
        twinSpeechTrack: { kind: "audio" } as never,
      }),
    ).toEqual({
      state: "speaking",
      audioTrack: { kind: "audio" },
      source: "twin-speech",
    });
  });

  it("falls back to twin runtime state when no audio track is available", () => {
    expect(
      resolveAgentAudio({
        fallbackState: "thinking",
        liveKit: null,
        speechCommand: null,
        twinSpeechTrack: undefined,
      }),
    ).toEqual({
      state: "thinking",
      source: "twin-runtime",
    });
  });
});
