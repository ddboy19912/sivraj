import { describe, expect, it, vi } from "vitest";
import {
  createConfiguredStructuredGenerator,
  createConfiguredSpeechToTextTranscriber,
  createOpenAIStructuredGenerator,
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

describe("createOpenAIStructuredGenerator", () => {
  it("requests strict JSON output from chat completions", async () => {
    const fetchMock = vi.fn(async () => Response.json({
      choices: [
        {
          message: {
            content: JSON.stringify({ entities: [] }),
          },
        },
      ],
      usage: { total_tokens: 12 },
    }));
    const generator = createOpenAIStructuredGenerator({
      provider: "openai",
      apiKey: "test-key",
      model: "gpt-4o-mini",
      fetch: fetchMock,
    });

    const result = await generator.generateJson({
      system: "Return JSON.",
      prompt: "Extract entities.",
    });

    expect(result).toMatchObject({
      json: { entities: [] },
      provider: "openai",
      model: "gpt-4o-mini",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.openai.com/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: {
          authorization: "Bearer test-key",
          "content-type": "application/json",
        },
        body: expect.stringContaining('"response_format":{"type":"json_object"}'),
      }),
    );
  });

  it("accepts OpenAI-compatible base URLs with a trailing v1 segment", async () => {
    const fetchMock = vi.fn(async () => Response.json({
      choices: [{ message: { content: JSON.stringify({ entities: [] }) } }],
    }));
    const generator = createOpenAIStructuredGenerator({
      provider: "openai",
      apiKey: "test-key",
      model: "openrouter/model",
      baseUrl: "https://openrouter.ai/api/v1",
      fetch: fetchMock,
    });

    await generator.generateJson({
      system: "Return JSON.",
      prompt: "Extract entities.",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/chat/completions",
      expect.any(Object),
    );
  });

  it("retries empty structured responses from OpenAI-compatible providers", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({
        choices: [{ message: { content: "" } }],
      }))
      .mockResolvedValueOnce(Response.json({
        choices: [{ message: { content: JSON.stringify({ entities: [] }) } }],
      }));
    const generator = createOpenAIStructuredGenerator({
      provider: "openai",
      apiKey: "test-key",
      model: "openrouter/free-model",
      fetch: fetchMock,
      maxRetries: 1,
    });

    const result = await generator.generateJson({
      system: "Return JSON.",
      prompt: "Extract entities.",
    });

    expect(result).toMatchObject({
      json: { entities: [] },
      metadata: { attempt: 2 },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("accepts JSON wrapped in markdown fences", async () => {
    const fetchMock = vi.fn(async () => Response.json({
      choices: [
        {
          message: {
            content: "```json\n{\"memories\":[]}\n```",
          },
        },
      ],
    }));
    const generator = createOpenAIStructuredGenerator({
      provider: "openai",
      apiKey: "test-key",
      fetch: fetchMock,
    });

    const result = await generator.generateJson({
      system: "Return JSON.",
      prompt: "Extract memories.",
    });

    expect(result.json).toEqual({ memories: [] });
  });

  it("retries malformed fenced JSON before failing the structured task", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({
        choices: [{ message: { content: "``` \n   \t}\n```" } }],
      }))
      .mockResolvedValueOnce(Response.json({
        choices: [{ message: { content: JSON.stringify({ memories: [] }) } }],
      }));
    const generator = createOpenAIStructuredGenerator({
      provider: "openai",
      apiKey: "test-key",
      fetch: fetchMock,
      maxRetries: 1,
    });

    const result = await generator.generateJson({
      system: "Return JSON.",
      prompt: "Extract memories.",
    });

    expect(result).toMatchObject({
      json: { memories: [] },
      metadata: { attempt: 2 },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("aborts hanging structured generation requests", async () => {
    const fetchMock = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
    );
    const generator = createOpenAIStructuredGenerator({
      provider: "openai",
      apiKey: "test-key",
      fetch: fetchMock,
      maxRetries: 0,
      timeoutMs: 1,
    });

    await expect(
      generator.generateJson({
        system: "Return JSON.",
        prompt: "Extract memories.",
      }),
    ).rejects.toThrow(/aborted/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("createConfiguredStructuredGenerator", () => {
  it("returns null when LLM is not configured", () => {
    expect(createConfiguredStructuredGenerator({})).toBeNull();
  });

  it("uses the general LLM config", () => {
    expect(createConfiguredStructuredGenerator({
      LLM_API_KEY: "llm-key",
      LLM_MODEL: "gpt-4o",
    })).not.toBeNull();
  });
});
