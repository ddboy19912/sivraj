import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TwinSpeechPlayer } from "@/components/app/TwinSpeechPlayer";

describe("TwinSpeechPlayer", () => {
  beforeEach(() => {
    Object.defineProperty(HTMLMediaElement.prototype, "play", {
      configurable: true,
      value: vi.fn().mockResolvedValue(undefined),
    });
  });

  it("does not render without a playback command", () => {
    render(
      <TwinSpeechPlayer
        command={null}
        onRuntimeEvent={vi.fn()}
        onPlaybackCompleted={vi.fn()}
      />,
    );

    expect(screen.queryByLabelText("Twin speech audio")).toBeNull();
  });

  it("marks playback completed when the final clip ends", async () => {
    const onPlaybackCompleted = vi.fn().mockResolvedValue(undefined);

    render(
      <TwinSpeechPlayer
        command={{
          eventId: "event-1",
          clipId: "event-1#0",
          audioUrl: "blob:speech",
          isFinalClip: true,
        }}
        onRuntimeEvent={vi.fn()}
        onPlaybackCompleted={onPlaybackCompleted}
      />,
    );

    fireEvent.ended(screen.getByLabelText("Twin speech audio"));

    await waitFor(() => {
      expect(onPlaybackCompleted).toHaveBeenCalledWith("event-1");
    });
  });

  it("advances to the next clip instead of completing on a non-final clip", () => {
    const onRuntimeEvent = vi.fn();
    const onPlaybackCompleted = vi.fn();

    render(
      <TwinSpeechPlayer
        command={{
          eventId: "event-1",
          clipId: "event-1#0",
          audioUrl: "blob:speech",
          isFinalClip: false,
        }}
        onRuntimeEvent={onRuntimeEvent}
        onPlaybackCompleted={onPlaybackCompleted}
      />,
    );

    fireEvent.ended(screen.getByLabelText("Twin speech audio"));

    expect(onRuntimeEvent).toHaveBeenCalledWith({
      type: "speech.clip_advanced",
      eventId: "event-1",
    });
    expect(onPlaybackCompleted).not.toHaveBeenCalled();
  });

  it("reports failed playback without consuming the event", () => {
    const onRuntimeEvent = vi.fn();
    const onPlaybackCompleted = vi.fn();

    render(
      <TwinSpeechPlayer
        command={{
          eventId: "event-1",
          clipId: "event-1#0",
          audioUrl: "blob:speech",
          isFinalClip: true,
        }}
        onRuntimeEvent={onRuntimeEvent}
        onPlaybackCompleted={onPlaybackCompleted}
      />,
    );

    fireEvent.error(screen.getByLabelText("Twin speech audio"));

    expect(onRuntimeEvent).toHaveBeenCalledWith({
      type: "speech.failed",
      eventId: "event-1",
      reason: "Playback failed.",
    });
    expect(onPlaybackCompleted).not.toHaveBeenCalled();
  });
});
