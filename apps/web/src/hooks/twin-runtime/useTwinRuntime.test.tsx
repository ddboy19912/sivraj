import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { postAuthedAudio } from "@/lib/api";
import { useTwinRuntime } from "@/hooks/twin-runtime/useTwinRuntime";
import type { Session } from "@/lib/session";

vi.mock("@/lib/api", () => ({
  postAuthedAudio: vi.fn(),
  postAuthedJson: vi.fn(),
}));

const postAuthedAudioMock = vi.mocked(postAuthedAudio);

const session: Session = {
  token: "token",
  refreshToken: "refresh",
  expiresAt: "2099-01-01T00:00:00.000Z",
  twinId: "twin-test",
  walletAddress: "0x123",
};

const firstMeetEvent = {
  type: "first_meet_intro.requested",
  eventId: "twin-test:first-meet-intro",
  dedupeKey: "twin-test:first-meet-intro",
  text: "Hi Fortune, it's nice to meet you.",
  voiceStyle: "energetic",
} as const;
const firstMeetEvents = [firstMeetEvent];

describe("useTwinRuntime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    postAuthedAudioMock.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.mocked(console.error).mockRestore();
    vi.useRealTimers();
  });

  it("fails pending speech when voice generation hangs", async () => {
    postAuthedAudioMock.mockImplementation(
      (_path, _body, _session, _onSessionRefreshed, signal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        }),
    );

    const { result } = renderHook(() =>
      useTwinRuntime({
        events: firstMeetEvents,
        session,
        setSession: vi.fn(),
      }),
    );

    expect(postAuthedAudioMock).toHaveBeenCalledWith(
      "/v1/twins/twin-test/voice/speak",
      expect.objectContaining({ text: firstMeetEvent.text }),
      session,
      expect.any(Function),
      expect.any(AbortSignal),
    );
    expect(postAuthedAudioMock).toHaveBeenCalledTimes(1);
    const signal = postAuthedAudioMock.mock.lastCall?.[4] as AbortSignal;

    act(() => {
      vi.advanceTimersByTime(45_000);
    });

    expect(signal.aborted).toBe(true);
    expect(result.current.runtimeState).toMatchObject({
      status: "failed",
      eventId: firstMeetEvent.eventId,
      reason: "Speech generation timed out.",
      retryable: true,
    });
  });

  it("keeps a pending speech request alive across equivalent session rerenders", () => {
    postAuthedAudioMock.mockImplementation(
      (_path, _body, _session, _onSessionRefreshed, signal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        }),
    );

    const { rerender } = renderHook(
      ({ currentSession }) =>
        useTwinRuntime({
          events: firstMeetEvents,
          session: currentSession,
          setSession: vi.fn(),
        }),
      { initialProps: { currentSession: session } },
    );

    expect(postAuthedAudioMock).toHaveBeenCalledTimes(1);
    const signal = postAuthedAudioMock.mock.lastCall?.[4] as AbortSignal;

    rerender({ currentSession: { ...session } });

    expect(signal.aborted).toBe(false);
    expect(postAuthedAudioMock).toHaveBeenCalledTimes(1);
  });

  it("fails pending speech when voice generation rejects", async () => {
    postAuthedAudioMock.mockRejectedValue(
      new Error("503: voice_service_unavailable"),
    );

    const { result } = renderHook(() =>
      useTwinRuntime({
        events: firstMeetEvents,
        session,
        setSession: vi.fn(),
      }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.runtimeState).toMatchObject({
      status: "failed",
      eventId: firstMeetEvent.eventId,
      reason: "503: voice_service_unavailable",
      retryable: true,
    });
  });

  it("logs and returns to idle when a quiet greeting speech request rejects", async () => {
    const greetingEvent = {
      type: "speech.requested" as const,
      eventId: "home-session-greeting-twin-test-with-you",
      dedupeKey: "home-session-greeting-twin-test-with-you",
      text: "Hi Fortune. How's your day going?",
      voiceStyle: "energetic" as const,
      failureMode: "quiet" as const,
    };
    const error = new Error("503: voice_service_unavailable");
    postAuthedAudioMock.mockRejectedValue(error);

    const { result } = renderHook(() =>
      useTwinRuntime({
        events: [greetingEvent],
        session,
        setSession: vi.fn(),
      }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(console.error).toHaveBeenCalledWith(
      "Home greeting speech failed.",
      error,
    );
    expect(result.current.runtimeState).toEqual({
      status: "idle",
      processedEventIds: [greetingEvent.eventId],
    });
  });
});
