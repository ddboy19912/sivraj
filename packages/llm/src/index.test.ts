import { describe, expect, it, vi } from "vitest";
import {
  createConfiguredSpeechToTextTranscriber,
  createOpenAISpeechToTextTranscriber,
} from "./index.js";

describe("createOpenAISpeechToTextTranscriber", () => {
  it("posts audio to the OpenAI transcription endpoint", async () => {
    const fetchMock = vi.fn(async () => Response.json({ text: "Launch sooner." }));
    const transcriber = createOpenAISpeechToTextTranscriber({
      provider: "openai",
      apiKey: "test-key",
      model: "gpt-4o-mini-transcribe",
      fetch: fetchMock,
    });

    const result = await transcriber.transcribe({
      audioBase64: Buffer.from("fake audio").toString("base64"),
      fileName: "founder-reflection.m4a",
      mimeType: "audio/mp4",
    });

    expect(result).toEqual({
      text: "Launch sooner.",
      provider: "openai",
      model: "gpt-4o-mini-transcribe",
      metadata: {},
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.openai.com/v1/audio/transcriptions",
      expect.objectContaining({
        method: "POST",
        headers: {
          authorization: "Bearer test-key",
        },
        body: expect.any(FormData),
      }),
    );
  });

  it("surfaces provider errors without leaking huge bodies", async () => {
    const fetchMock = vi.fn(async () => new Response("bad request", { status: 400 }));
    const transcriber = createOpenAISpeechToTextTranscriber({
      provider: "openai",
      apiKey: "test-key",
      fetch: fetchMock,
    });

    await expect(
      transcriber.transcribe({
        audioBase64: Buffer.from("fake audio").toString("base64"),
        fileName: "voice-note.mp3",
      }),
    ).rejects.toThrow("speech_to_text_failed:400:bad request");
  });
});

describe("createConfiguredSpeechToTextTranscriber", () => {
  it("returns null when speech-to-text is not configured", () => {
    expect(createConfiguredSpeechToTextTranscriber({})).toBeNull();
  });

  it("uses dedicated speech-to-text env over general LLM env", () => {
    const transcriber = createConfiguredSpeechToTextTranscriber({
      LLM_API_KEY: "llm-key",
      SPEECH_TO_TEXT_API_KEY: "stt-key",
      SPEECH_TO_TEXT_MODEL: "gpt-4o-transcribe",
    });

    expect(transcriber).not.toBeNull();
  });
});
