import { describe, expect, it } from "vitest";
import { parseGradioAudioResult, readFirstString } from "./voice-service-parse.js";

describe("voice service parse helpers", () => {
  it("reads the first nested string value", () => {
    expect(readFirstString({ data: [{ output: "audio" }] })).toBe("audio");
    expect(readFirstString(["", "value"])).toBe("value");
  });

  it("parses gradio audio results", () => {
    expect(parseGradioAudioResult({ data: ["audio-bytes"] })).toBe("audio-bytes");
  });

  it("rejects missing audio payloads", () => {
    expect(() => parseGradioAudioResult({ data: [] })).toThrow("voice_service_missing_audio");
  });
});
