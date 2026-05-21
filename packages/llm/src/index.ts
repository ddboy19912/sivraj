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

export type SpeechToTextConfig = {
  provider: "openai";
  apiKey: string;
  model?: string;
  baseUrl?: string;
  fetch?: typeof fetch;
};

export const DEFAULT_SPEECH_TO_TEXT_MODEL = "gpt-4o-mini-transcribe";

export function createOpenAISpeechToTextTranscriber(
  config: SpeechToTextConfig,
): SpeechToTextTranscriber {
  const fetchImpl = config.fetch ?? fetch;
  const model = config.model || DEFAULT_SPEECH_TO_TEXT_MODEL;
  const baseUrl = (config.baseUrl || "https://api.openai.com").replace(/\/+$/, "");

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

function truncate(value: string): string {
  return value.length > 500 ? `${value.slice(0, 500)}...` : value;
}
