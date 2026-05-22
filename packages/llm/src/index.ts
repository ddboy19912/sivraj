export type SpeechToTextInput = {
  audioBase64: string;
  fileName?: string | null;
  mimeType?: string | null;
  prompt?: string | null;
};

export type SpeechToTextOutput = {
  text: string;
  provider: string;
  model: string;
  metadata?: Record<string, unknown>;
};

export type SpeechToTextTranscriber = {
  transcribe(input: SpeechToTextInput): Promise<SpeechToTextOutput>;
};

export type StructuredGenerationInput = {
  system: string;
  prompt: string;
  temperature?: number;
  timeoutMs?: number;
};

export type StructuredGenerationOutput = {
  json: unknown;
  provider: string;
  model: string;
  metadata?: Record<string, unknown>;
};

export type StructuredGenerator = {
  generateJson(input: StructuredGenerationInput): Promise<StructuredGenerationOutput>;
};

export type SpeechToTextConfig = {
  provider: "openai";
  apiKey: string;
  model?: string;
  baseUrl?: string;
  fetch?: typeof fetch;
};

export const DEFAULT_SPEECH_TO_TEXT_MODEL = "gpt-4o-mini-transcribe";
export const DEFAULT_STRUCTURED_GENERATION_MODEL = "gpt-4o-mini";

export function createOpenAISpeechToTextTranscriber(
  config: SpeechToTextConfig,
): SpeechToTextTranscriber {
  const fetchImpl = config.fetch ?? fetch;
  const model = config.model || DEFAULT_SPEECH_TO_TEXT_MODEL;
  const baseUrl = normalizeOpenAICompatibleBaseUrl(config.baseUrl || "https://api.openai.com");

  return {
    async transcribe(input) {
      const audio = decodeBase64(input.audioBase64);
      const audioBuffer = audio.buffer.slice(
        audio.byteOffset,
        audio.byteOffset + audio.byteLength,
      ) as ArrayBuffer;
      const fileName = input.fileName || defaultAudioFileName(input.mimeType);
      const mimeType = input.mimeType || inferMimeType(fileName);
      const body = new FormData();

      body.append("file", new Blob([audioBuffer], { type: mimeType }), fileName);
      body.append("model", model);
      body.append("response_format", "json");

      if (input.prompt) {
        body.append("prompt", input.prompt);
      }

      const response = await fetchImpl(`${baseUrl}/v1/audio/transcriptions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${config.apiKey}`,
        },
        body,
      });

      if (!response.ok) {
        throw new Error(
          `speech_to_text_failed:${response.status}:${truncate(await response.text())}`,
        );
      }

      const payload = await response.json() as { text?: unknown; language?: unknown; duration?: unknown };
      const text = typeof payload.text === "string" ? payload.text.trim() : "";

      return {
        text,
        provider: config.provider,
        model,
        metadata: {
          ...(typeof payload.language === "string" ? { language: payload.language } : {}),
          ...(typeof payload.duration === "number" ? { duration: payload.duration } : {}),
        },
      };
    },
  };
}

export function createConfiguredSpeechToTextTranscriber(
  env: Record<string, string | undefined>,
): SpeechToTextTranscriber | null {
  const provider = env["SPEECH_TO_TEXT_PROVIDER"] || env["LLM_PROVIDER"] || "openai";

  if (provider === "none") {
    return null;
  }

  if (provider !== "openai") {
    throw new Error(`Unsupported speech-to-text provider: ${provider}`);
  }

  const apiKey = env["SPEECH_TO_TEXT_API_KEY"] || env["LLM_API_KEY"];

  if (!apiKey) {
    return null;
  }

  return createOpenAISpeechToTextTranscriber({
    provider: "openai",
    apiKey,
    model: env["SPEECH_TO_TEXT_MODEL"] || DEFAULT_SPEECH_TO_TEXT_MODEL,
    baseUrl: env["SPEECH_TO_TEXT_BASE_URL"] || env["OPENAI_BASE_URL"],
  });
}

export function createOpenAIStructuredGenerator(config: {
  provider: "openai";
  apiKey: string;
  model?: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  maxRetries?: number;
  timeoutMs?: number;
}): StructuredGenerator {
  const fetchImpl = config.fetch ?? fetch;
  const model = config.model || DEFAULT_STRUCTURED_GENERATION_MODEL;
  const baseUrl = normalizeOpenAICompatibleBaseUrl(config.baseUrl || "https://api.openai.com");
  const maxRetries = config.maxRetries ?? 2;
  const timeoutMs = config.timeoutMs ?? 45_000;

  return {
    async generateJson(input) {
      let lastError: Error | null = null;

      for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
        try {
          return await generateOpenAICompatibleJson({
            apiKey: config.apiKey,
            baseUrl,
            fetchImpl,
            input,
            model,
            provider: config.provider,
            attempt,
            timeoutMs: input.timeoutMs ?? timeoutMs,
          });
        } catch (error) {
          lastError = error instanceof Error ? error : new Error("structured_generation_failed");

          if (!isRetryableStructuredGenerationError(lastError) || attempt > maxRetries) {
            throw lastError;
          }

          await sleep(100 * attempt);
        }
      }

      throw lastError ?? new Error("structured_generation_failed");
    },
  };
}

export function createConfiguredStructuredGenerator(
  env: Record<string, string | undefined>,
): StructuredGenerator | null {
  const provider = env["LLM_PROVIDER"] || "openai";

  if (provider === "none") {
    return null;
  }

  if (provider !== "openai") {
    throw new Error(`Unsupported structured generation provider: ${provider}`);
  }

  const apiKey = env["LLM_API_KEY"];

  if (!apiKey) {
    return null;
  }

  return createOpenAIStructuredGenerator({
    provider: "openai",
    apiKey,
    model: env["LLM_MODEL"] || DEFAULT_STRUCTURED_GENERATION_MODEL,
    baseUrl: env["OPENAI_BASE_URL"],
    timeoutMs: readPositiveInteger(env["LLM_REQUEST_TIMEOUT_MS"], 45_000),
  });
}

function decodeBase64(value: string): Uint8Array {
  const audio = Buffer.from(value, "base64");

  if (audio.length === 0) {
    throw new Error("empty_audio_payload");
  }

  return audio;
}

function defaultAudioFileName(mimeType?: string | null): string {
  if (mimeType === "audio/mpeg") {
    return "voice-note.mp3";
  }

  if (mimeType === "audio/mp4") {
    return "voice-note.m4a";
  }

  if (mimeType === "audio/wav" || mimeType === "audio/x-wav") {
    return "voice-note.wav";
  }

  if (mimeType === "audio/webm") {
    return "voice-note.webm";
  }

  return "voice-note.mp3";
}

function inferMimeType(fileName: string): string {
  const normalized = fileName.toLowerCase();

  if (normalized.endsWith(".m4a") || normalized.endsWith(".mp4")) {
    return "audio/mp4";
  }

  if (normalized.endsWith(".wav")) {
    return "audio/wav";
  }

  if (normalized.endsWith(".webm")) {
    return "audio/webm";
  }

  return "audio/mpeg";
}

async function generateOpenAICompatibleJson(input: {
  apiKey: string;
  baseUrl: string;
  fetchImpl: typeof fetch;
  input: StructuredGenerationInput;
  model: string;
  provider: "openai";
  attempt: number;
  timeoutMs: number;
}): Promise<StructuredGenerationOutput> {
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), input.timeoutMs);

  const response = await input.fetchImpl(`${input.baseUrl}/v1/chat/completions`, {
    method: "POST",
    signal: abortController.signal,
    headers: {
      authorization: `Bearer ${input.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: input.model,
      temperature: input.input.temperature ?? 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: input.input.system },
        { role: "user", content: input.input.prompt },
      ],
    }),
  }).finally(() => clearTimeout(timeout));

  if (!response.ok) {
    throw new Error(
      `structured_generation_failed:${response.status}:${truncate(await response.text())}`,
    );
  }

  const payload = await response.json() as {
    choices?: Array<{ message?: { content?: unknown } }>;
    usage?: unknown;
  };
  const content = payload.choices?.[0]?.message?.content;

  if (typeof content !== "string" || content.trim().length === 0) {
    throw new Error("structured_generation_empty");
  }
  const json = parseStructuredJsonContent(content);

  return {
    json,
    provider: input.provider,
    model: input.model,
    metadata: {
      usage: payload.usage,
      attempt: input.attempt,
    },
  };
}

function parseStructuredJsonContent(content: string): unknown {
  const normalized = unwrapJsonMarkdownFence(content.trim());

  try {
    return JSON.parse(normalized);
  } catch (error) {
    const extracted = extractJsonObject(normalized);

    if (extracted && extracted !== normalized) {
      try {
        return JSON.parse(extracted);
      } catch {
        // Throw the original parse error below so logs preserve the provider output shape.
      }
    }

    throw new Error(
      `structured_generation_invalid_json:${error instanceof Error ? error.message : "unknown"}`,
    );
  }
}

function unwrapJsonMarkdownFence(content: string): string {
  const match = content.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);

  return match?.[1]?.trim() ?? content;
}

function extractJsonObject(content: string): string | null {
  const firstObject = content.indexOf("{");
  const firstArray = content.indexOf("[");
  const starts: number[] = [firstObject, firstArray].filter((index) => index >= 0);

  if (starts.length === 0) {
    return null;
  }

  const start = Math.min(...starts);
  const opening = content[start];
  const closing = opening === "{" ? "}" : "]";
  const end = content.lastIndexOf(closing);

  if (end <= start) {
    return null;
  }

  return content.slice(start, end + 1).trim();
}

function isRetryableStructuredGenerationError(error: Error): boolean {
  if (error.name === "AbortError") {
    return true;
  }

  return [
    "structured_generation_empty",
    "structured_generation_invalid_json",
    "structured_generation_failed:429",
    "structured_generation_failed:500",
    "structured_generation_failed:502",
    "structured_generation_failed:503",
    "structured_generation_failed:504",
    "fetch failed",
  ].some((fragment) => error.message.includes(fragment));
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function truncate(value: string): string {
  return value.length > 500 ? `${value.slice(0, 500)}...` : value;
}

function normalizeOpenAICompatibleBaseUrl(value: string): string {
  const trimmed = value.replace(/\/+$/, "");

  return trimmed.endsWith("/v1") ? trimmed.slice(0, -3) : trimmed;
}
