import { describe, expect, it } from "vitest";
import {
  createInitialTwinRuntimeState,
  twinRuntimeReducer,
} from "@/lib/twin/runtime-reducer";

const firstMeetEvent = {
  type: "first_meet_intro.requested",
  eventId: "twin:first-meet-intro",
  dedupeKey: "twin:first-meet-intro",
  text: "Hi! I'm Nova.",
  voiceStyle: "energetic",
} as const;

describe("twinRuntimeReducer", () => {
  it("moves requested intro events into speech preparation", () => {
    expect(
      twinRuntimeReducer(createInitialTwinRuntimeState(), firstMeetEvent),
    ).toMatchObject({
      status: "preparing_speech",
      eventId: firstMeetEvent.eventId,
      text: firstMeetEvent.text,
    });
  });

  it("moves prepared speech into speaking", () => {
    const preparing = twinRuntimeReducer(
      createInitialTwinRuntimeState(),
      firstMeetEvent,
    );

    expect(
      twinRuntimeReducer(preparing, {
        type: "speech.audio_ready",
        eventId: firstMeetEvent.eventId,
        audioUrl: "blob:speech",
      }),
    ).toMatchObject({
      status: "speaking",
      eventId: firstMeetEvent.eventId,
      audioUrl: "blob:speech",
    });
  });

  it("marks completed speech consumed and ignores duplicate events", () => {
    const preparing = twinRuntimeReducer(
      createInitialTwinRuntimeState(),
      firstMeetEvent,
    );
    const completed = twinRuntimeReducer(preparing, {
      type: "speech.completed",
      eventId: firstMeetEvent.eventId,
    });

    expect(completed).toMatchObject({
      status: "idle",
      processedEventIds: [firstMeetEvent.eventId],
    });
    expect(twinRuntimeReducer(completed, firstMeetEvent)).toBe(completed);
  });

  it("keeps failed speech retryable without consuming the event", () => {
    const preparing = twinRuntimeReducer(
      createInitialTwinRuntimeState(),
      firstMeetEvent,
    );

    expect(
      twinRuntimeReducer(preparing, {
        type: "speech.failed",
        eventId: firstMeetEvent.eventId,
        reason: "Audio unavailable",
      }),
    ).toMatchObject({
      status: "failed",
      eventId: firstMeetEvent.eventId,
      retryable: true,
      processedEventIds: [],
    });
  });

  it("re-enters speech preparation when a retryable event is requested again", () => {
    const preparing = twinRuntimeReducer(
      createInitialTwinRuntimeState(),
      firstMeetEvent,
    );
    const failed = twinRuntimeReducer(preparing, {
      type: "speech.failed",
      eventId: firstMeetEvent.eventId,
      reason: "Audio unavailable",
    });

    expect(twinRuntimeReducer(failed, firstMeetEvent)).toMatchObject({
      status: "preparing_speech",
      eventId: firstMeetEvent.eventId,
      text: firstMeetEvent.text,
      processedEventIds: [],
    });
  });
});
