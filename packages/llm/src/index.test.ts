import { describe, expect, it, vi } from "vitest";
import {
  createCartesiaSpeechToTextTranscriber,
  createOpenAICompatibleChatGenerator,
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

  it("posts JSON audio to the OpenRouter transcription endpoint", async () => {
    const fetchMock = vi.fn(async () => Response.json({
      text: "OpenRouter transcript.",
      usage: { total_tokens: 12 },
    }));
    const transcriber = createOpenAISpeechToTextTranscriber({
      provider: "openrouter",
      apiKey: "or-key",
      model: "openai/whisper-large-v3",
      baseUrl: "https://openrouter.ai/api",
      fetch: fetchMock,
    });

    const result = await transcriber.transcribe({
      audioBase64: Buffer.from("fake audio").toString("base64"),
      fileName: "voice-note.wav",
      mimeType: "audio/wav",
    });

    expect(result).toEqual({
      text: "OpenRouter transcript.",
      provider: "openrouter",
      model: "openai/whisper-large-v3",
      metadata: { usage: { total_tokens: 12 } },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/audio/transcriptions",
      expect.objectContaining({
        method: "POST",
        headers: {
          authorization: "Bearer or-key",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          input_audio: {
            data: Buffer.from("fake audio").toString("base64"),
            format: "wav",
          },
          model: "openai/whisper-large-v3",
        }),
      }),
    );
  });
});

describe("createCartesiaSpeechToTextTranscriber", () => {
  it("posts audio to the Cartesia batch STT endpoint", async () => {
    const fetchMock = vi.fn(async () => Response.json({
      text: "Use Cartesia for speech.",
      language: "en",
      duration: 2.1,
      request_id: "req-123",
    }));
    const transcriber = createCartesiaSpeechToTextTranscriber({
      apiKey: "cartesia-key",
      model: "ink-whisper",
      fetch: fetchMock,
    });

    const result = await transcriber.transcribe({
      audioBase64: Buffer.from("fake audio").toString("base64"),
      fileName: "voice-chat.webm",
      mimeType: "audio/webm",
    });

    expect(result).toEqual({
      text: "Use Cartesia for speech.",
      provider: "cartesia",
      model: "ink-whisper",
      metadata: {
        language: "en",
        duration: 2.1,
        requestId: "req-123",
      },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.cartesia.ai/stt",
      expect.objectContaining({
        method: "POST",
        headers: {
          authorization: "Bearer cartesia-key",
          "cartesia-version": "2026-03-01",
        },
        body: expect.any(FormData),
      }),
    );
  });
});

describe("createConfiguredSpeechToTextTranscriber", () => {
  it("returns null when speech-to-text is not configured", () => {
    expect(createConfiguredSpeechToTextTranscriber({})).toBeNull();
  });

  it("does not use general LLM credentials for speech-to-text", () => {
    const transcriber = createConfiguredSpeechToTextTranscriber({
      LLM_API_KEY: "llm-key",
      SPEECH_TO_TEXT_MODEL: "gpt-4o-transcribe",
    });

    expect(transcriber).toBeNull();
  });

  it("uses Cartesia credentials for Cartesia speech-to-text", () => {
    const transcriber = createConfiguredSpeechToTextTranscriber({
      CARTESIA_API_KEY: "cartesia-key",
      SPEECH_TO_TEXT_MODEL: "ink-whisper",
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

  it("uses OpenRouter as an OpenAI-compatible structured generation provider", async () => {
    const generator = createConfiguredStructuredGenerator({
      LLM_PROVIDER: "openrouter",
      LLM_API_KEY: "or-key",
      OPENAI_BASE_URL: "https://openrouter.ai/api",
      LLM_MODEL: "google/gemini-2.5-flash-lite",
    });

    expect(generator).not.toBeNull();
  });
});

describe("createOpenAICompatibleChatGenerator", () => {
  it("streams text through the AI SDK OpenAI-compatible provider", async () => {
    const fetchMock = vi.fn(async () => new Response(
      [
        'data: {"id":"chatcmpl_1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"Hel"},"finish_reason":null}]}',
        "",
        'data: {"id":"chatcmpl_1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"lo"},"finish_reason":null}]}',
        "",
        'data: {"id":"chatcmpl_1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
        "",
        "data: [DONE]",
        "",
      ].join("\n"),
      {
        headers: { "content-type": "text/event-stream" },
      },
    ));
    const generator = createOpenAICompatibleChatGenerator({
      provider: "openrouter",
      apiKey: "test-key",
      model: "openai/gpt-4o-mini",
      baseUrl: "https://openrouter.ai/api/v1",
      fetch: fetchMock,
    });

    const stream = generator.streamChat({
      messages: [{ role: "user", content: "Say hello" }],
    });
    const chunks: string[] = [];
    for await (const chunk of stream.textStream) {
      chunks.push(chunk);
    }
    const result = await stream.result;

    expect(chunks.join("")).toBe("Hello");
    expect(result).toMatchObject({
      content: "Hello",
      provider: "openrouter",
      model: "openai/gpt-4o-mini",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer test-key",
        }),
      }),
    );
  });

  it("passes system chat instructions through the AI SDK system option", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = vi.fn(async () => new Response(
      [
        'data: {"id":"chatcmpl_1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"Hi"},"finish_reason":null}]}',
        "",
        'data: {"id":"chatcmpl_1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
        "",
        "data: [DONE]",
        "",
      ].join("\n"),
      {
        headers: { "content-type": "text/event-stream" },
      },
    ));
    const generator = createOpenAICompatibleChatGenerator({
      provider: "openrouter",
      apiKey: "test-key",
      model: "openai/gpt-4o-mini",
      baseUrl: "https://openrouter.ai/api/v1",
      fetch: fetchMock,
    });

    const stream = generator.streamChat({
      messages: [
        { role: "system", content: "Speak as Jarvis." },
        { role: "user", content: "Say hi" },
      ],
    });

    try {
      for await (const _chunk of stream.textStream) {
        // drain stream
      }
      await stream.result;

      expect(warnSpy).not.toHaveBeenCalledWith(
        expect.stringContaining("System messages in the prompt or messages fields"),
      );
    } finally {
      warnSpy.mockRestore();
    }
  });
});
