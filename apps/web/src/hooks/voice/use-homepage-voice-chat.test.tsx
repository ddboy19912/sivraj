import { describe, expect, it } from "vitest";
import {
  resolvePushToTalkKeyboardAction,
  voiceRecordingErrorMessage,
} from "@/hooks/voice/use-homepage-voice-chat";

describe("resolvePushToTalkKeyboardAction", () => {
  it("starts on Space keydown when idle", () => {
    expect(resolvePushToTalkKeyboardAction({
      phase: "idle",
      eventType: "keydown",
      repeat: false,
    })).toBe("start");
  });

  it("ignores repeat keydown", () => {
    expect(resolvePushToTalkKeyboardAction({
      phase: "recording_push_to_talk",
      eventType: "keydown",
      repeat: true,
    })).toBe("ignore");
  });

  it("stops recording from Space keydown when active", () => {
    expect(resolvePushToTalkKeyboardAction({
      phase: "recording_push_to_talk",
      eventType: "keydown",
      repeat: false,
    })).toBe("stop");
  });

  it("does not stop on keyup", () => {
    expect(resolvePushToTalkKeyboardAction({
      phase: "recording_push_to_talk",
      eventType: "keyup",
      repeat: false,
    })).toBe("ignore");
  });
});

describe("voiceRecordingErrorMessage", () => {
  it("maps missing microphone browser errors to a clear recovery message", () => {
    expect(voiceRecordingErrorMessage(
      new DOMException("Requested device not found", "NotFoundError"),
    )).toBe(
      "No microphone was found. Connect or enable an input device, then press Space again.",
    );
  });

  it("maps blocked microphone permission errors to browser settings guidance", () => {
    expect(voiceRecordingErrorMessage(
      new DOMException("Permission denied", "NotAllowedError"),
    )).toBe(
      "Microphone access is blocked. Allow microphone permission in your browser settings, then press Space again.",
    );
  });
});
