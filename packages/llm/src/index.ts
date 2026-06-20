import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { streamText } from "ai";
import { fetchWithTimeout, truncateText } from "@sivraj/core";

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

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ChatGenerationInput = {
  messages: ChatMessage[];
  temperature?: number;
  timeoutMs?: number;
};

export type ChatGenerationOutput = {
  content: string;
  provider: string;
  model: string;
  metadata?: Record<string, unknown>;
};

export type ChatStreamChunk = {
  type: "text";
  text: string;
};

export type ChatStreamOutput = {
  provider: string;
  model: string;
  textStream: AsyncIterable<string>;
  result: Promise<ChatGenerationOutput>;
};

export type ChatGenerator = {
  generateChat(input: ChatGenerationInput): Promise<ChatGenerationOutput>;
  streamChat(input: ChatGenerationInput & { signal?: AbortSignal }): ChatStreamOutput;
};

export type TextEmbeddingInput = {
  texts: string[];
  timeoutMs?: number;
};

export type TextEmbeddingOutput = {
  embeddings: number[][];
  provider: string;
  model: string;
  metadata?: Record<string, unknown>;
};

export type TextEmbedder = {
  embedTexts(input: TextEmbeddingInput): Promise<TextEmbeddingOutput>;
};

export type SpeechToTextConfig = {
  provider: string;
  apiKey: string;
  model?: string;
  baseUrl?: string;
  fetch?: typeof fetch;
};

export const DEFAULT_SPEECH_TO_TEXT_MODEL = "gpt-4o-mini-transcribe";
export const DEFAULT_CARTESIA_SPEECH_TO_TEXT_MODEL = "ink-whisper";
const DEFAULT_CARTESIA_API_VERSION = "2026-03-01";
export const DEFAULT_CHAT_GENERATION_MODEL = "google/gemini-2.5-flash-lite";
export const DEFAULT_STRUCTURED_GENERATION_MODEL = DEFAULT_CHAT_GENERATION_MODEL;
export const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";

export function createOpenAISpeechToTextTranscriber(
  config: SpeechToTextConfig,
): SpeechToTextTranscriber {
  const fetchImpl = config.fetch ?? fetch;
  const model = config.model || DEFAULT_SPEECH_TO_TEXT_MODEL;
  const baseUrl = normalizeOpenAICompatibleBaseUrl(config.baseUrl || "https://api.openai.com");

  return {
    async transcribe(input) {
      if (config.provider === "openrouter") {
        return transcribeWithOpenRouter({
          apiKey: config.apiKey,
          baseUrl,
          fetchImpl,
          input,
          model,
          provider: config.provider,
        });
      }

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
          `speech_to_text_failed:${response.status}:${truncateText(await response.text(), 500)}`,
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

export function createCartesiaSpeechToTextTranscriber(config: {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  apiVersion?: string;
  fetch?: typeof fetch;
}): SpeechToTextTranscriber {
  const fetchImpl = config.fetch ?? fetch;
  const model = config.model || DEFAULT_CARTESIA_SPEECH_TO_TEXT_MODEL;
  const baseUrl = normalizeBaseUrl(config.baseUrl || "https://api.cartesia.ai");

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

      const response = await fetchImpl(`${baseUrl}/stt`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${config.apiKey}`,
          "cartesia-version": config.apiVersion || DEFAULT_CARTESIA_API_VERSION,
        },
        body,
      });

      if (!response.ok) {
        throw new Error(
          `speech_to_text_failed:${response.status}:${truncateText(await response.text(), 500)}`,
        );
      }

      const payload = await response.json() as {
        text?: unknown;
        language?: unknown;
        duration?: unknown;
        request_id?: unknown;
        words?: unknown;
      };
      const text = typeof payload.text === "string" ? payload.text.trim() : "";

      return {
        text,
        provider: "cartesia",
        model,
        metadata: {
          ...(typeof payload.language === "string" ? { language: payload.language } : {}),
          ...(typeof payload.duration === "number" ? { duration: payload.duration } : {}),
          ...(typeof payload.request_id === "string" ? { requestId: payload.request_id } : {}),
          ...(Array.isArray(payload.words) ? { words: payload.words } : {}),
        },
      };
    },
  };
}

export function createConfiguredSpeechToTextTranscriber(
  env: Record<string, string | undefined>,
): SpeechToTextTranscriber | null {
  const apiKey = env["CARTESIA_API_KEY"];
  if (!apiKey) {
    return null;
  }

  return createCartesiaSpeechToTextTranscriber({
    apiKey,
    model: env["SPEECH_TO_TEXT_MODEL"] || DEFAULT_CARTESIA_SPEECH_TO_TEXT_MODEL,
    baseUrl: env["SPEECH_TO_TEXT_BASE_URL"] || env["CARTESIA_BASE_URL"],
    apiVersion: env["CARTESIA_VERSION"],
  });
}

export function createOpenAIStructuredGenerator(config: {
  provider: string;
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
  const provider = env["LLM_PROVIDER"] || "openrouter";

  if (provider === "none") {
    return null;
  }

  const apiKey = env["LLM_API_KEY"];
  const baseUrl = defaultChatBaseUrl(provider, env["OPENAI_BASE_URL"]);

  if (provider !== "ollama" && !apiKey) {
    return null;
  }

  return createOpenAIStructuredGenerator({
    provider,
    apiKey: apiKey ?? "",
    model: env["LLM_MODEL"] || DEFAULT_STRUCTURED_GENERATION_MODEL,
    baseUrl,
    timeoutMs: readPositiveInteger(env["LLM_REQUEST_TIMEOUT_MS"], 45_000),
  });
}

export function createOpenAICompatibleChatGenerator(config: {
  provider: string;
  apiKey?: string | null;
  model?: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  maxRetries?: number;
  timeoutMs?: number;
  extraHeaders?: Record<string, string>;
}): ChatGenerator {
  const fetchImpl = config.fetch ?? fetch;
  const model = config.model || DEFAULT_CHAT_GENERATION_MODEL;
  const baseUrl = normalizeOpenAICompatibleBaseUrl(config.baseUrl || "https://api.openai.com");
  const maxRetries = config.maxRetries ?? 1;
  const timeoutMs = config.timeoutMs ?? 45_000;

  return {
    async generateChat(input) {
      let lastError: Error | null = null;

      for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
        try {
          return await generateOpenAICompatibleChat({
            apiKey: config.apiKey ?? "",
            baseUrl,
            extraHeaders: config.extraHeaders,
            fetchImpl,
            input,
            model,
            provider: config.provider,
            attempt,
            timeoutMs: input.timeoutMs ?? timeoutMs,
          });
        } catch (error) {
          lastError = error instanceof Error ? error : new Error("chat_generation_failed");

          if (!isRetryableChatGenerationError(lastError) || attempt > maxRetries) {
            throw lastError;
          }

          await sleep(100 * attempt);
        }
      }

      throw lastError ?? new Error("chat_generation_failed");
    },
    streamChat(input) {
      return streamOpenAICompatibleChat({
        apiKey: config.apiKey ?? "",
        baseUrl,
        extraHeaders: config.extraHeaders,
        input,
        model,
        provider: config.provider,
        fetchImpl,
        timeoutMs: input.timeoutMs ?? timeoutMs,
      });
    },
  };
}

export function createConfiguredChatGenerator(
  env: Record<string, string | undefined>,
): ChatGenerator | null {
  const provider = env["LLM_PROVIDER"] || "openrouter";

  if (provider === "none") {
    return null;
  }

  const apiKey = env["LLM_API_KEY"];
  const baseUrl = defaultChatBaseUrl(provider, env["OPENAI_BASE_URL"]);

  if (provider !== "ollama" && !apiKey) {
    return null;
  }

  return createOpenAICompatibleChatGenerator({
    provider,
    apiKey,
    model: env["LLM_MODEL"] || DEFAULT_CHAT_GENERATION_MODEL,
    baseUrl,
    timeoutMs: readPositiveInteger(env["LLM_REQUEST_TIMEOUT_MS"], 45_000),
  });
}

export function createOpenAICompatibleTextEmbedder(config: {
  provider: string;
  apiKey?: string | null;
  model?: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}): TextEmbedder {
  const fetchImpl = config.fetch ?? fetch;
  const model = config.model || DEFAULT_EMBEDDING_MODEL;
  const baseUrl = normalizeOpenAICompatibleBaseUrl(config.baseUrl || "https://api.openai.com");
  const timeoutMs = config.timeoutMs ?? 30_000;

  return {
    async embedTexts(input) {
      const texts = input.texts
        .map((text) => text.trim())
        .filter((text) => text.length > 0);

      if (texts.length === 0) {
        return {
          embeddings: [],
          provider: config.provider,
          model,
        };
      }

      const headers: Record<string, string> = {
        "content-type": "application/json",
      };

      if (config.apiKey) {
        headers.authorization = `Bearer ${config.apiKey}`;
      }

      const response = await fetchWithTimeout(fetchImpl, `${baseUrl}/v1/embeddings`, {
        method: "POST",
        timeoutMs: input.timeoutMs ?? timeoutMs,
        headers,
        body: JSON.stringify({
          model,
          input: texts,
        }),
      });

      if (!response.ok) {
        throw new Error(`embedding_failed:${response.status}:${truncateText(await response.text())}`);
      }

      const payload = await response.json() as {
        data?: Array<{ embedding?: unknown; index?: unknown }>;
        usage?: unknown;
      };
      const embeddings = (payload.data ?? [])
        .slice()
        .sort((a, b) => readEmbeddingIndex(a.index) - readEmbeddingIndex(b.index))
        .map((item) => readEmbeddingVector(item.embedding));

      if (embeddings.length !== texts.length || embeddings.some((embedding) => embedding.length === 0)) {
        throw new Error("embedding_failed:invalid_response");
      }

      return {
        embeddings,
        provider: config.provider,
        model,
        metadata: { usage: payload.usage },
      };
    },
  };
}

export function createConfiguredTextEmbedder(
  env: Record<string, string | undefined>,
): TextEmbedder | null {
  const provider = env["EMBEDDING_PROVIDER"] || env["LLM_PROVIDER"] || "openai";

  if (provider === "none") {
    return null;
  }

  const apiKey = env["EMBEDDING_API_KEY"] || env["LLM_API_KEY"];
  const baseUrl = env["EMBEDDING_BASE_URL"] || defaultChatBaseUrl(provider, env["OPENAI_BASE_URL"]);

  if (provider !== "ollama" && !apiKey) {
    return null;
  }

  return createOpenAICompatibleTextEmbedder({
    provider,
    apiKey,
    model: env["EMBEDDING_MODEL"] || (
      provider === "openrouter" ? "openai/text-embedding-3-small" : DEFAULT_EMBEDDING_MODEL
    ),
    baseUrl,
    timeoutMs: readPositiveInteger(env["EMBEDDING_REQUEST_TIMEOUT_MS"], 30_000),
  });
}

function decodeBase64(value: string): Uint8Array {
  const audio = Buffer.from(value, "base64");

  if (audio.length === 0) {
    throw new Error("empty_audio_payload");
  }

  return audio;
}

async function transcribeWithOpenRouter(input: {
  apiKey: string;
  baseUrl: string;
  fetchImpl: typeof fetch;
  input: SpeechToTextInput;
  model: string;
  provider: string;
}): Promise<SpeechToTextOutput> {
  const response = await input.fetchImpl(`${input.baseUrl}/v1/audio/transcriptions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${input.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      input_audio: {
        data: stripDataUrlPrefix(input.input.audioBase64),
        format: inferAudioFormat(input.input.fileName, input.input.mimeType),
      },
      model: input.model,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `speech_to_text_failed:${response.status}:${truncateText(await response.text(), 500)}`,
    );
  }

  const payload = await response.json() as { text?: unknown; usage?: unknown };
  const text = typeof payload.text === "string" ? payload.text.trim() : "";

  return {
    text,
    provider: input.provider,
    model: input.model,
    metadata: {
      usage: payload.usage,
    },
  };
}

function stripDataUrlPrefix(value: string): string {
  const commaIndex = value.indexOf(",");

  return value.startsWith("data:") && commaIndex >= 0 ? value.slice(commaIndex + 1) : value;
}

function inferAudioFormat(fileName?: string | null, mimeType?: string | null): string {
  const normalizedMimeType = mimeType?.toLowerCase();

  if (normalizedMimeType?.includes("wav")) {
    return "wav";
  }

  if (normalizedMimeType?.includes("webm")) {
    return "webm";
  }

  if (normalizedMimeType?.includes("mp4") || normalizedMimeType?.includes("m4a")) {
    return "mp4";
  }

  if (normalizedMimeType?.includes("mpeg") || normalizedMimeType?.includes("mp3")) {
    return "mp3";
  }

  const normalizedFileName = fileName?.toLowerCase() ?? "";

  if (normalizedFileName.endsWith(".wav")) {
    return "wav";
  }

  if (normalizedFileName.endsWith(".webm")) {
    return "webm";
  }

  if (normalizedFileName.endsWith(".mp4") || normalizedFileName.endsWith(".m4a")) {
    return "mp4";
  }

  return "mp3";
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
  provider: string;
  attempt: number;
  timeoutMs: number;
}): Promise<StructuredGenerationOutput> {
  const { content, usage } = await postOpenAICompatibleCompletion({
    apiKey: input.apiKey,
    baseUrl: input.baseUrl,
    fetchImpl: input.fetchImpl,
    timeoutMs: input.timeoutMs,
    body: {
      model: input.model,
      temperature: input.input.temperature ?? 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: input.input.system },
        { role: "user", content: input.input.prompt },
      ],
    },
    failurePrefix: "structured_generation_failed",
    emptyError: "structured_generation_empty",
  });
  const json = parseStructuredJsonContent(content);

  return {
    json,
    provider: input.provider,
    model: input.model,
    metadata: {
      usage,
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

async function generateOpenAICompatibleChat(input: {
  apiKey: string;
  baseUrl: string;
  extraHeaders?: Record<string, string>;
  fetchImpl: typeof fetch;
  input: ChatGenerationInput;
  model: string;
  provider: string;
  attempt: number;
  timeoutMs: number;
}): Promise<ChatGenerationOutput> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...(input.extraHeaders ?? {}),
  };

  if (input.apiKey) {
    headers.authorization = `Bearer ${input.apiKey}`;
  }

  const { content, usage } = await postOpenAICompatibleCompletion({
    apiKey: input.apiKey,
    baseUrl: input.baseUrl,
    fetchImpl: input.fetchImpl,
    timeoutMs: input.timeoutMs,
    headers,
    body: {
      model: input.model,
      temperature: input.input.temperature ?? 0.2,
      messages: input.input.messages,
    },
    failurePrefix: "chat_generation_failed",
    emptyError: "chat_generation_empty",
  });

  return {
    content: content.trim(),
    provider: input.provider,
    model: input.model,
    metadata: {
      usage,
      attempt: input.attempt,
    },
  };
}

function streamOpenAICompatibleChat(input: {
  apiKey: string;
  baseUrl: string;
  extraHeaders?: Record<string, string>;
  fetchImpl: typeof fetch;
  input: ChatGenerationInput & { signal?: AbortSignal };
  model: string;
  provider: string;
  timeoutMs: number;
}): ChatStreamOutput {
  const provider = createOpenAICompatible({
    name: input.provider,
    apiKey: input.apiKey || undefined,
    baseURL: `${input.baseUrl}/v1`,
    headers: input.extraHeaders,
    fetch: input.fetchImpl,
    includeUsage: true,
  });
  const timeoutController = new AbortController();
  const timeout = setTimeout(() => {
    timeoutController.abort(new Error("chat_stream_timeout"));
  }, input.timeoutMs);
  const clearStreamTimeout = () => clearTimeout(timeout);
  const signal = anySignal([input.input.signal, timeoutController.signal]);
  const prompt = splitSystemMessages(input.input.messages);
  const result = streamText({
    model: provider(input.model),
    system: prompt.system,
    messages: prompt.messages,
    temperature: input.input.temperature ?? 0.2,
    abortSignal: signal,
    onError({ error }) {
      clearStreamTimeout();
      console.warn("chat stream failed", {
        provider: input.provider,
        model: input.model,
        error: error instanceof Error ? error.message : String(error),
      });
    },
    onFinish() {
      clearStreamTimeout();
    },
  });

  return {
    provider: input.provider,
    model: input.model,
    textStream: result.textStream,
    result: Promise.resolve(result.text).then(async (content) => ({
      content: content.trim(),
      provider: input.provider,
      model: input.model,
      metadata: {
        usage: await Promise.resolve(result.usage).catch(() => null),
        finishReason: await Promise.resolve(result.finishReason).catch(() => null),
      },
    })),
  };
}

function splitSystemMessages(messages: ChatMessage[]) {
  const systemMessages = messages.filter((message) => message.role === "system");
  const nonSystemMessages = messages.filter((message) => message.role !== "system");

  return {
    system: systemMessages.length > 0
      ? systemMessages.map((message) => message.content).join("\n\n")
      : undefined,
    messages: nonSystemMessages,
  };
}

async function postOpenAICompatibleCompletion(input: {
  apiKey: string;
  baseUrl: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  headers?: Record<string, string>;
  body: Record<string, unknown>;
  failurePrefix: string;
  emptyError: string;
}): Promise<{ content: string; usage: unknown }> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...(input.headers ?? {}),
  };

  if (input.apiKey) {
    headers.authorization = `Bearer ${input.apiKey}`;
  }

  const response = await fetchWithTimeout(input.fetchImpl, `${input.baseUrl}/v1/chat/completions`, {
    method: "POST",
    timeoutMs: input.timeoutMs,
    headers,
    body: JSON.stringify(input.body),
  });

  if (!response.ok) {
    throw new Error(
      `${input.failurePrefix}:${response.status}:${truncateText(await response.text())}`,
    );
  }

  const payload = await response.json() as {
    choices?: Array<{ message?: { content?: unknown } }>;
    usage?: unknown;
  };
  const content = payload.choices?.[0]?.message?.content;

  if (typeof content !== "string" || content.trim().length === 0) {
    throw new Error(input.emptyError);
  }

  return {
    content,
    usage: payload.usage,
  };
}

function isRetryableChatGenerationError(error: Error): boolean {
  if (error.name === "AbortError") {
    return true;
  }

  return [
    "chat_generation_empty",
    "chat_generation_failed:429",
    "chat_generation_failed:500",
    "chat_generation_failed:502",
    "chat_generation_failed:503",
    "chat_generation_failed:504",
    "fetch failed",
  ].some((fragment) => error.message.includes(fragment));
}

function defaultChatBaseUrl(provider: string, configuredBaseUrl: string | undefined): string {
  if (configuredBaseUrl) {
    return configuredBaseUrl;
  }

  if (provider === "openrouter") {
    return "https://openrouter.ai/api/v1";
  }

  if (provider === "ollama") {
    return "http://localhost:11434/v1";
  }

  return "https://api.openai.com";
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readEmbeddingIndex(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function readEmbeddingVector(value: unknown): number[] {
  return Array.isArray(value)
    ? value.filter((item): item is number => typeof item === "number" && Number.isFinite(item))
    : [];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeOpenAICompatibleBaseUrl(value: string): string {
  const trimmed = value.replace(/\/+$/, "");

  return trimmed.endsWith("/v1") ? trimmed.slice(0, -3) : trimmed;
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function anySignal(signals: Array<AbortSignal | undefined>): AbortSignal | undefined {
  const activeSignals = signals.filter((signal): signal is AbortSignal => Boolean(signal));

  if (activeSignals.length === 0) {
    return undefined;
  }

  if (activeSignals.length === 1) {
    return activeSignals[0];
  }

  const controller = new AbortController();
  const abort = (signal: AbortSignal) => {
    if (!controller.signal.aborted) {
      controller.abort(signal.reason);
    }
  };

  for (const signal of activeSignals) {
    if (signal.aborted) {
      abort(signal);
      break;
    }

    signal.addEventListener("abort", () => abort(signal), { once: true });
  }

  return controller.signal;
}
