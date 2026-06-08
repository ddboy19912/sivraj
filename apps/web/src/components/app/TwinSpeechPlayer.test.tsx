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

  it("marks playback completed when speech ends", async () => {
    const onPlaybackCompleted = vi.fn().mockResolvedValue(undefined);

    render(
      <TwinSpeechPlayer
        command={{ eventId: "event-1", audioUrl: "blob:speech" }}
        onRuntimeEvent={vi.fn()}
        onPlaybackCompleted={onPlaybackCompleted}
      />,
    );

    fireEvent.ended(screen.getByLabelText("Twin speech audio"));

    await waitFor(() => {
      expect(onPlaybackCompleted).toHaveBeenCalledWith("event-1");
    });
  });

  it("reports failed playback without consuming the event", () => {
    const onRuntimeEvent = vi.fn();
    const onPlaybackCompleted = vi.fn();

    render(
      <TwinSpeechPlayer
        command={{ eventId: "event-1", audioUrl: "blob:speech" }}
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
