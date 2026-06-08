import { describe, expect, it } from "vitest";
import {
  buildGradioQueueJoinBody,
  decodeGradioAudioOutput,
  gradioJoinError,
  parseGradioQueueResult,
} from "./voice-service-gradio.js";

describe("voice service gradio helpers", () => {
  it("builds gradio queue join payloads", () => {
    expect(buildGradioQueueJoinBody({
      text: "Hello",
      voiceId: "warm_operator",
      sessionHash: "session-1",
    })).toMatchObject({
      data: ["Hello", "warm_operator", "en", "", 0, "", "", ""],
      session_hash: "session-1",
    });
  });

  it("parses completed gradio queue streams", () => {
    const body = [
      'data: {"msg":"estimation"}',
      'data: {"msg":"process_completed","success":true,"output":{"data":["audio"]}}',
    ].join("\n");

    expect(parseGradioQueueResult(body)).toEqual({
      success: true,
      output: { data: ["audio"] },
    });
  });

  it("decodes gradio audio output", () => {
    const encoded = Buffer.from("hello").toString("base64");
    expect(decodeGradioAudioOutput({ data: [encoded] })).toMatchObject({
      contentType: "audio/wav",
    });
    expect(() => decodeGradioAudioOutput({ data: [] })).toThrow("voice_service_missing_audio");
  });

  it("formats gradio join errors", () => {
    expect(gradioJoinError(500, "failed").message).toContain("voice_service_failed:500");
  });
});
