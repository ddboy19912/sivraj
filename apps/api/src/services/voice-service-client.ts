import { Buffer } from "node:buffer";
import { fetchWithTimeout, truncateText } from "@sivraj/core";
import {
  buildGradioQueueJoinBody,
  decodeGradioAudioOutput,
  gradioJoinError,
  parseGradioQueueResult,
} from "./voice-service-gradio.js";

export type VoicePreset = {
  id: string;
  name: string;
  description: string;
  language: string;
  style: string;
  provider: "chatterbox_turbo" | "cartesia";
};

export type VoiceSynthesisInput = {
  text: string;
  voiceId: string;
  language?: string;
  style?: string;
  exaggeration?: number;
  referenceAudioBase64?: string;
  referenceMimeType?: string | null;
  providerVoiceId?: string | null;
};

export type VoiceSynthesisOutput = {
  audioBytes: Uint8Array;
  contentType: string;
};

export type VoiceCloneInput = {
  audioBase64: string;
  mimeType: string;
  fileName: string;
  name: string;
  description?: string;
  language?: string;
};

export type VoiceSynthesizer = {
  provider: VoicePreset["provider"];
  synthesize(input: VoiceSynthesisInput): Promise<VoiceSynthesisOutput>;
  cloneVoice?(input: VoiceCloneInput): Promise<{ providerVoiceId: string }>;
};

export const DEFAULT_VOICE_PRESET_ID = "warm_operator";

const DEFAULT_CARTESIA_VOICE_ID = "db6b0ed5-d5d3-463d-ae85-518a07d3c2b4";

const CARTESIA_PRESET_VOICE_IDS: Record<string, string> = {
  warm_operator: "db6b0ed5-d5d3-463d-ae85-518a07d3c2b4",
  focused_analyst: "47c38ca4-5f35-497b-b1a3-415245fb35e1",
  energetic_builder: "630ed21c-2c5c-41cf-9d82-10a7fd668370",
  soft_narrator: "62ae83ad-4f6a-430b-af41-a9bede9286ca",
  calm_guide: "ef191366-f52f-447a-a398-ed8c0f2943a1",
};

const VOICE_PRESETS: VoicePreset[] = [
  {
    id: "warm_operator",
    name: "Skylar",
    description: "Approachable American female voice for friendly guidance.",
    language: "en",
    style: "warm",
    provider: "chatterbox_turbo",
  },
  {
    id: "focused_analyst",
    name: "Daniel",
    description: "Clear American male voice for crisp assistant responses.",
    language: "en",
    style: "focused",
    provider: "chatterbox_turbo",
  },
  {
    id: "energetic_builder",
    name: "Corey",
    description: "Cheerful American male voice for casual conversation.",
    language: "en",
    style: "energetic",
    provider: "chatterbox_turbo",
  },
  {
    id: "soft_narrator",
    name: "Gemma",
    description: "Confident British female voice for professional assistance.",
    language: "en",
    style: "soft",
    provider: "chatterbox_turbo",
  },
  {
    id: "calm_guide",
    name: "Archie",
    description: "Warm British male voice for relaxed dialogue.",
    language: "en",
    style: "calm",
    provider: "chatterbox_turbo",
  },
];

export function getVoicePresetsForProvider(
  provider: VoicePreset["provider"],
): VoicePreset[] {
  return VOICE_PRESETS.map((preset) => ({
    ...preset,
    provider,
  }));
}

export function createConfiguredVoiceSynthesizer(
  env: Record<string, string | undefined>,
): VoiceSynthesizer | undefined {
  const kind = env["VOICE_SERVICE_KIND"];
  if (kind === "cartesia") {
    return createCartesiaVoiceSynthesizer({
      apiKey: env["CARTESIA_API_KEY"] ?? env["VOICE_SERVICE_API_KEY"],
      apiVersion: env["CARTESIA_VERSION"] ?? "2026-03-01",
      modelId: env["CARTESIA_MODEL_ID"] ?? "sonic-3.5",
      defaultVoiceId: DEFAULT_CARTESIA_VOICE_ID,
      voiceIds: CARTESIA_PRESET_VOICE_IDS,
      timeoutMs: readPositiveInteger(env["VOICE_SERVICE_TIMEOUT_MS"], 45_000),
    });
  }

  const serviceUrl = env["VOICE_SERVICE_URL"]?.replace(/\/+$/, "");

  if (!serviceUrl) {
    return undefined;
  }

  const config = {
    serviceUrl,
    apiKey: env["VOICE_SERVICE_API_KEY"],
    timeoutMs: readPositiveInteger(env["VOICE_SERVICE_TIMEOUT_MS"], 45_000),
  };

  return kind === "gradio"
    ? createGradioVoiceSynthesizer(config)
    : createHttpVoiceSynthesizer(config);
}

function createCartesiaVoiceSynthesizer(config: {
  apiKey?: string;
  apiVersion?: string;
  modelId?: string;
  defaultVoiceId?: string;
  voiceIds?: Record<string, string>;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): VoiceSynthesizer | undefined {
  if (!config.apiKey) {
    return undefined;
  }

  const fetchImpl = config.fetchImpl ?? fetch;

  return {
    provider: "cartesia",
    async synthesize(input) {
      const voiceId = input.providerVoiceId
        ?? config.voiceIds?.[input.voiceId]
        ?? config.defaultVoiceId;

      if (!voiceId) {
        throw new Error(`cartesia_voice_id_missing:${input.voiceId}`);
      }

      const response = await fetchWithTimeout(fetchImpl, "https://api.cartesia.ai/tts/bytes", {
        method: "POST",
        timeoutMs: config.timeoutMs ?? 45_000,
        headers: {
          authorization: `Bearer ${config.apiKey}`,
          "cartesia-version": config.apiVersion ?? "2026-03-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model_id: config.modelId ?? "sonic-3.5",
          transcript: input.text,
          voice: {
            mode: "id",
            id: voiceId,
          },
          output_format: {
            container: "wav",
            encoding: "pcm_f32le",
            sample_rate: 44_100,
          },
          language: input.language ?? "en",
          generation_config: {
            speed: 1,
            volume: 1,
          },
        }),
      });

      return readVoiceSynthesisResponse(response, "cartesia_tts_failed");
    },
    async cloneVoice(input) {
      const form = new FormData();
      const bytes = Buffer.from(stripDataUrlPrefix(input.audioBase64), "base64");
      form.append("clip", new Blob([bytes], { type: input.mimeType }), input.fileName);
      form.append("name", input.name);
      form.append("language", input.language ?? "en");
      if (input.description) {
        form.append("description", input.description);
      }

      const response = await fetchImpl("https://api.cartesia.ai/voices/clone", {
        method: "POST",
        headers: {
          authorization: `Bearer ${config.apiKey}`,
          "cartesia-version": config.apiVersion ?? "2026-03-01",
        },
        body: form,
      });

      if (!response.ok) {
        throw new Error(
          `cartesia_clone_failed:${response.status}:${truncateText(await response.text())}`,
        );
      }

      const payload = await response.json() as { id?: unknown };
      if (typeof payload.id !== "string" || !payload.id) {
        throw new Error(`cartesia_clone_missing_voice_id:${truncateText(JSON.stringify(payload))}`);
      }

      return { providerVoiceId: payload.id };
    },
  };
}

function createHttpVoiceSynthesizer(config: {
  serviceUrl: string;
  apiKey?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): VoiceSynthesizer {
  const fetchImpl = config.fetchImpl ?? fetch;

  return {
    provider: "chatterbox_turbo",
    async synthesize(input) {
      const response = await fetchWithTimeout(fetchImpl, `${config.serviceUrl}/synthesize`, {
        method: "POST",
        timeoutMs: config.timeoutMs ?? 45_000,
        headers: {
          "content-type": "application/json",
          ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
        },
        body: JSON.stringify(input),
      });

      return readVoiceSynthesisResponse(response, "voice_service_failed");
    },
  };
}

function createGradioVoiceSynthesizer(config: {
  serviceUrl: string;
  apiKey?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): VoiceSynthesizer {
  const fetchImpl = config.fetchImpl ?? fetch;

  return {
    provider: "chatterbox_turbo",
    async synthesize(input) {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        config.timeoutMs ?? 45_000,
      );

      try {
        const joinBody = buildGradioQueueJoinBody({
          text: input.text,
          voiceId: input.voiceId,
          language: input.language,
          style: input.style,
          exaggeration: input.exaggeration,
          referenceAudioBase64: input.referenceAudioBase64,
          referenceMimeType: input.referenceMimeType,
          apiKey: config.apiKey,
        });
        const joinResponse = await fetchImpl(
          `${config.serviceUrl}/gradio_api/queue/join`,
          {
            method: "POST",
            signal: controller.signal,
            headers: {
              "content-type": "application/json",
            },
            body: JSON.stringify(joinBody),
          },
        );

        if (!joinResponse.ok) {
          throw gradioJoinError(joinResponse.status, await joinResponse.text());
        }

        const queueResponse = await fetchImpl(
          `${config.serviceUrl}/gradio_api/queue/data?session_hash=${encodeURIComponent(joinBody.session_hash)}`,
          { signal: controller.signal },
        );

        if (!queueResponse.ok) {
          throw gradioJoinError(queueResponse.status, await queueResponse.text());
        }

        const completed = parseGradioQueueResult(await queueResponse.text());
        if (!completed.success) {
          throw new Error(
            `voice_service_failed:gradio:${truncateText(JSON.stringify(completed.output))}`,
          );
        }

        return decodeGradioAudioOutput(completed.output);
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

export function isVoicePresetId(value: string): boolean {
  return VOICE_PRESETS.some((preset) => preset.id === value);
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

async function readVoiceSynthesisResponse(
  response: Response,
  failurePrefix: string,
): Promise<VoiceSynthesisOutput> {
  if (!response.ok) {
    throw new Error(`${failurePrefix}:${response.status}:${truncateText(await response.text())}`);
  }

  const audioBytes = new Uint8Array(await response.arrayBuffer());
  if (audioBytes.length === 0) {
    throw new Error("voice_service_empty_audio");
  }

  return {
    audioBytes,
    contentType: response.headers.get("content-type") ?? "audio/wav",
  };
}

function stripDataUrlPrefix(value: string): string {
  const marker = ";base64,";
  const index = value.indexOf(marker);
  return index >= 0 ? value.slice(index + marker.length) : value;
}

