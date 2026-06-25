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
      clips: ["blob:speech"],
      clipCursor: 0,
      streamClosed: true,
    });
  });

  it("streams sentence chunks into an ordered playlist", () => {
    const eventId = "voice-1:speech";
    const chunk = {
      type: "speech.audio_chunk" as const,
      eventId,
      dedupeKey: "voice:voice-1",
      sourceEventId: "voice-1",
    };

    const speaking = twinRuntimeReducer(createInitialTwinRuntimeState(), {
      ...chunk,
      audioUrl: "blob:one",
    });
    expect(speaking).toMatchObject({
      status: "speaking",
      eventId,
      clips: ["blob:one"],
      clipCursor: 0,
      streamClosed: false,
    });

    const appended = twinRuntimeReducer(speaking, {
      ...chunk,
      audioUrl: "blob:two",
    });
    expect(appended).toMatchObject({
      clips: ["blob:one", "blob:two"],
      clipCursor: 0,
    });

    const advanced = twinRuntimeReducer(appended, {
      type: "speech.clip_advanced",
      eventId,
    });
    expect(advanced).toMatchObject({ clipCursor: 1, status: "speaking" });

    const closed = twinRuntimeReducer(advanced, {
      type: "speech.stream_closed",
      eventId,
    });
    expect(closed).toMatchObject({ streamClosed: true, clipCursor: 1 });

    const completed = twinRuntimeReducer(closed, {
      type: "speech.clip_advanced",
      eventId,
    });
    expect(completed).toMatchObject({
      status: "idle",
      processedEventIds: [eventId],
    });
  });

  it("completes a buffering stream when it closes after the last clip played", () => {
    const eventId = "voice-2:speech";
    const speaking = twinRuntimeReducer(createInitialTwinRuntimeState(), {
      type: "speech.audio_chunk",
      eventId,
      dedupeKey: "voice:voice-2",
      sourceEventId: "voice-2",
      audioUrl: "blob:one",
    });
    const buffering = twinRuntimeReducer(speaking, {
      type: "speech.clip_advanced",
      eventId,
    });
    expect(buffering).toMatchObject({ status: "speaking", clipCursor: 1 });

    const completed = twinRuntimeReducer(buffering, {
      type: "speech.stream_closed",
      eventId,
    });
    expect(completed).toMatchObject({
      status: "idle",
      processedEventIds: [eventId],
    });
  });

  it("keeps thinking when stale listening completion arrives after processing starts", () => {
    const eventId = "voice-1";
    const listening = twinRuntimeReducer(createInitialTwinRuntimeState(), {
      type: "agent.listening_started",
      eventId,
    });
    const thinking = twinRuntimeReducer(listening, {
      type: "agent.thinking_started",
      eventId,
      label: "Transcribing",
    });
    const completed = twinRuntimeReducer(thinking, {
      type: "agent.listening_completed",
      eventId,
    });

    expect(completed).toMatchObject({
      status: "thinking",
      eventId,
      label: "Transcribing",
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

  it("consumes quiet speech failures and returns to idle", () => {
    const greetingEvent = {
      type: "speech.requested" as const,
      eventId: "home-session-greeting-twin-with-you",
      dedupeKey: "home-session-greeting-twin-with-you",
      text: "Hi. How's your day going?",
      voiceStyle: "energetic" as const,
      failureMode: "quiet" as const,
    };
    const preparing = twinRuntimeReducer(
      createInitialTwinRuntimeState(),
      greetingEvent,
    );

    expect(
      twinRuntimeReducer(preparing, {
        type: "speech.failed",
        eventId: greetingEvent.eventId,
        reason: "Audio unavailable",
      }),
    ).toMatchObject({
      status: "idle",
      processedEventIds: [greetingEvent.eventId],
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
