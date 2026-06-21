import { describe, expect, it } from "vitest";
import {
  createInitialHomepageVoiceState,
  homepageVoiceReducer,
} from "@/lib/voice/voice-chat-reducer";
import type { VoiceSettings } from "@/types/voice.types";

describe("homepage voice reducer", () => {
  it("arms wake mode only when settings and browser support agree", () => {
    const initial = homepageVoiceReducer(
      createInitialHomepageVoiceState(),
      { type: "WAKE_SUPPORT_RESOLVED", supported: true },
    );
    const ready = homepageVoiceReducer(initial, {
      type: "SETTINGS_READY",
      settings: voiceSettings({ wakeEnabled: true }),
      profile: null,
    });

    expect(ready.phase).toBe("armed_wake");
  });

  it("moves through push-to-talk and transcript states explicitly", () => {
    const eventId = "voice-1";
    const recording = homepageVoiceReducer(createInitialHomepageVoiceState(), {
      type: "RECORDING_STARTED",
      eventId,
    });
    const transcribing = homepageVoiceReducer(recording, {
      type: "TRANSCRIBING",
      eventId,
    });
    const transcript = homepageVoiceReducer(transcribing, {
      type: "TRANSCRIPT_READY",
      eventId,
      text: "What should I do next?",
    });
    const thinking = homepageVoiceReducer(transcript, {
      type: "THINKING",
      eventId,
    });

    expect(recording.phase).toBe("recording_push_to_talk");
    expect(transcribing.phase).toBe("transcribing");
    expect(transcript.userTranscript).toBe("What should I do next?");
    expect(thinking.phase).toBe("thinking");
  });

  it("does not let late settings readiness reset an active recording", () => {
    const eventId = "voice-1";
    const recording = homepageVoiceReducer(createInitialHomepageVoiceState(), {
      type: "RECORDING_STARTED",
      eventId,
    });
    const ready = homepageVoiceReducer(recording, {
      type: "SETTINGS_READY",
      settings: voiceSettings({ wakeEnabled: true }),
      profile: null,
    });

    expect(ready).toMatchObject({
      phase: "recording_push_to_talk",
      activeEventId: eventId,
      settingsStatus: "ready",
    });
  });

  it("stores assistant text and returns to idle after speech", () => {
    const eventId = "voice-1";
    const active = homepageVoiceReducer(createInitialHomepageVoiceState(), {
      type: "RECORDING_STARTED",
      eventId,
    });
    const ready = homepageVoiceReducer(active, {
      type: "ASSISTANT_READY",
      eventId,
      text: "Start with the proposal.",
      threadId: "thread-1",
    });
    const speaking = homepageVoiceReducer(ready, {
      type: "SPEAKING",
      eventId,
    });
    const ended = homepageVoiceReducer(speaking, { type: "SPEECH_ENDED" });

    expect(ready.assistantTranscript).toBe("Start with the proposal.");
    expect(ready.activeThreadId).toBe("thread-1");
    expect(speaking.phase).toBe("speaking");
    expect(ended.phase).toBe("idle");
    expect(ended.activeEventId).toBeNull();
  });

  it("treats retrieval fallback text as a normal assistant response", () => {
    const eventId = "voice-1";
    const fallbackText = "I couldn’t retrieve that memory right now, so I can’t answer it safely.";
    const thinking = homepageVoiceReducer(
      {
        ...createInitialHomepageVoiceState(),
        phase: "thinking",
        activeEventId: eventId,
      },
      { type: "ASSISTANT_DELTA", eventId, delta: fallbackText },
    );
    const ready = homepageVoiceReducer(thinking, {
      type: "ASSISTANT_READY",
      eventId,
      text: fallbackText,
      threadId: "thread-1",
    });
    const speaking = homepageVoiceReducer(ready, {
      type: "SPEAKING",
      eventId,
    });

    expect(thinking.partialAssistantTranscript).toBe(fallbackText);
    expect(ready).toMatchObject({
      phase: "thinking",
      assistantTranscript: fallbackText,
      partialAssistantTranscript: "",
      error: null,
    });
    expect(speaking.phase).toBe("speaking");
  });

  it("models interruption as a named state before the next recording starts", () => {
    const speaking = homepageVoiceReducer(
      {
        ...createInitialHomepageVoiceState(),
        phase: "speaking",
        activeEventId: "voice-1",
      },
      { type: "INTERRUPTED", eventId: "voice-2" },
    );

    expect(speaking).toMatchObject({
      phase: "interrupted",
      activeEventId: "voice-2",
    });
  });

  it("clears partial assistant text on failure", () => {
    const failed = homepageVoiceReducer(
      {
        ...createInitialHomepageVoiceState(),
        phase: "thinking",
        activeEventId: "voice-1",
        partialAssistantTranscript: "Part",
      },
      { type: "FAILED", error: "Speech failed." },
    );

    expect(failed).toMatchObject({
      phase: "failed",
      activeEventId: null,
      partialAssistantTranscript: "",
      error: "Speech failed.",
    });
  });
});

function voiceSettings(overrides: Partial<VoiceSettings> = {}): VoiceSettings {
  return {
    twinId: "twin-1",
    wakeEnabled: false,
    wakePhrase: "Hey Jarvis",
    defaultWakePhrase: "Hey Jarvis",
    wakePhraseIsDefault: true,
    pushToTalkMode: "toggle",
    metadata: {},
    createdAt: null,
    updatedAt: null,
    ...overrides,
  };
}
