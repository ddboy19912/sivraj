import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { signSessionToken } from "@sivraj/auth";
import {
  auditEvents,
  twinVoiceProfiles,
  twinVoiceSettings,
  twins,
} from "@sivraj/db";
import type { AppDependencies } from "../app.js";
import { createVoiceRoutes } from "./voice.js";

const TWIN_ID = "00000000-0000-4000-8000-000000000001";

describe("voice routes", () => {
  it("rejects transcribe requests without audio", async () => {
    withAuthEnv();
    const app = createVoiceTestApp(createVoiceDependencies());
    const response = await app.request(`/v1/twins/${TWIN_ID}/voice/transcribe`, {
      method: "POST",
      body: JSON.stringify({}),
      headers: await authedHeaders(),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "missing_audio" });
  });

  it("reports missing speech-to-text configuration", async () => {
    withAuthEnv();
    const app = createVoiceTestApp(createVoiceDependencies({
      speechToTextTranscriber: null,
    }));
    const response = await app.request(`/v1/twins/${TWIN_ID}/voice/transcribe`, {
      method: "POST",
      body: JSON.stringify({ audioBase64: "YWJj" }),
      headers: await authedHeaders(),
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: "speech_to_text_not_configured",
    });
  });

  it("returns a trimmed transcript", async () => {
    withAuthEnv();
    const transcribe = vi.fn(async () => ({
      text: "  Launch the proposal.  ",
      provider: "openai",
      model: "gpt-4o-mini-transcribe",
      metadata: { duration: 1.2 },
    }));
    const app = createVoiceTestApp(createVoiceDependencies({
      speechToTextTranscriber: { transcribe },
    }));
    const response = await app.request(`/v1/twins/${TWIN_ID}/voice/transcribe`, {
      method: "POST",
      body: JSON.stringify({ audioBase64: "YWJj", mimeType: "audio/webm" }),
      headers: await authedHeaders(),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      text: "Launch the proposal.",
      provider: "openai",
      model: "gpt-4o-mini-transcribe",
    });
    expect(transcribe).toHaveBeenCalledWith(expect.objectContaining({
      audioBase64: "YWJj",
      mimeType: "audio/webm",
    }));
  });

  it("returns a short-lived realtime speech-to-text session", async () => {
    withAuthEnv();
    const createSession = vi.fn(async () => ({
      provider: "cartesia" as const,
      accessToken: "client-token",
      expiresIn: 60,
      websocketUrl: "wss://api.cartesia.ai",
      model: "ink-2",
      encoding: "pcm_s16le" as const,
      sampleRate: 48_000,
      apiVersion: "2026-03-01",
    }));
    const app = createVoiceTestApp(createVoiceDependencies({
      realtimeSpeechToTextTokenIssuer: {
        provider: "cartesia",
        createSession,
      },
    }));
    const response = await app.request(`/v1/twins/${TWIN_ID}/voice/realtime-token`, {
      method: "POST",
      body: JSON.stringify({}),
      headers: await authedHeaders(),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      provider: "cartesia",
      accessToken: "client-token",
      expiresIn: 60,
      websocketUrl: "wss://api.cartesia.ai",
      model: "ink-2",
      encoding: "pcm_s16le",
      sampleRate: 48_000,
      apiVersion: "2026-03-01",
    });
    expect(createSession).toHaveBeenCalledOnce();
  });

  it("reports missing realtime speech-to-text configuration", async () => {
    withAuthEnv();
    const app = createVoiceTestApp(createVoiceDependencies({
      realtimeSpeechToTextTokenIssuer: undefined,
    }));
    const response = await app.request(`/v1/twins/${TWIN_ID}/voice/realtime-token`, {
      method: "POST",
      body: JSON.stringify({}),
      headers: await authedHeaders(),
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: "realtime_speech_to_text_not_configured",
    });
  });

  it("returns a short-lived realtime text-to-speech session", async () => {
    withAuthEnv();
    const createSession = vi.fn(async () => ({
      provider: "cartesia" as const,
      accessToken: "tts-client-token",
      expiresIn: 60,
      websocketUrl: "wss://api.cartesia.ai",
      model: "sonic-3.5",
      voiceId: "db6b0ed5-d5d3-463d-ae85-518a07d3c2b4",
      language: "en",
      encoding: "pcm_s16le" as const,
      sampleRate: 44_100,
      apiVersion: "2026-03-01",
    }));
    const app = createVoiceTestApp(createVoiceDependencies({
      realtimeTextToSpeechTokenIssuer: {
        provider: "cartesia",
        createSession,
      },
    }));
    const response = await app.request(`/v1/twins/${TWIN_ID}/voice/realtime-tts-token`, {
      method: "POST",
      body: JSON.stringify({}),
      headers: await authedHeaders(),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      provider: "cartesia",
      accessToken: "tts-client-token",
      expiresIn: 60,
      websocketUrl: "wss://api.cartesia.ai",
      model: "sonic-3.5",
      voiceId: "db6b0ed5-d5d3-463d-ae85-518a07d3c2b4",
      language: "en",
      encoding: "pcm_s16le",
      sampleRate: 44_100,
      apiVersion: "2026-03-01",
    });
    expect(createSession).toHaveBeenCalledWith({
      voiceId: "db6b0ed5-d5d3-463d-ae85-518a07d3c2b4",
      language: "en",
    });
  });

  it("reports missing realtime text-to-speech configuration", async () => {
    withAuthEnv();
    const app = createVoiceTestApp(createVoiceDependencies({
      realtimeTextToSpeechTokenIssuer: undefined,
    }));
    const response = await app.request(`/v1/twins/${TWIN_ID}/voice/realtime-tts-token`, {
      method: "POST",
      body: JSON.stringify({}),
      headers: await authedHeaders(),
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: "realtime_text_to_speech_not_configured",
    });
  });

  it("returns default wake phrase for legacy settings", async () => {
    withAuthEnv();
    const app = createVoiceTestApp(createVoiceDependencies());
    const response = await app.request(`/v1/twins/${TWIN_ID}/voice/settings`, {
      headers: await authedHeaders(),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      twinId: TWIN_ID,
      wakeEnabled: false,
      wakePhrase: "Hey Jarvis",
      defaultWakePhrase: "Hey Jarvis",
      wakePhraseIsDefault: true,
      pushToTalkMode: "toggle",
    });
  });

  it("normalizes legacy hold voice settings to toggle", async () => {
    withAuthEnv();
    const rows = createVoiceRows();
    rows.settings.push({
      id: "00000000-0000-4000-8000-0000000000ab",
      twinId: TWIN_ID,
      wakeEnabled: false,
      wakePhrase: null,
      pushToTalkMode: "hold",
      metadata: {},
      createdAt: new Date("2026-06-19T00:00:00.000Z"),
      updatedAt: new Date("2026-06-19T00:00:00.000Z"),
    });
    const app = createVoiceTestApp(createVoiceDependencies({ db: createVoiceDb(rows) }));
    const response = await app.request(`/v1/twins/${TWIN_ID}/voice/settings`, {
      headers: await authedHeaders(),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({ pushToTalkMode: "toggle" });
  });

  it("validates wake phrase settings", async () => {
    withAuthEnv();
    const app = createVoiceTestApp(createVoiceDependencies());
    const response = await app.request(`/v1/twins/${TWIN_ID}/voice/settings`, {
      method: "PUT",
      body: JSON.stringify({ wakePhrase: "Jarvis" }),
      headers: await authedHeaders(),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "wake_phrase_requires_multiple_words",
    });
  });

  it("persists wake disabled when the client does not support wake phrase detection", async () => {
    withAuthEnv();
    const rows = createVoiceRows();
    const app = createVoiceTestApp(createVoiceDependencies({ db: createVoiceDb(rows) }));
    const response = await app.request(`/v1/twins/${TWIN_ID}/voice/settings`, {
      method: "PUT",
      body: JSON.stringify({
        wakeEnabled: true,
        wakePhrase: "Hey Jarvis",
        clientWakeSupported: false,
      }),
      headers: await authedHeaders(),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({ wakeEnabled: false, wakePhrase: "Hey Jarvis" });
    expect(rows.settings[0]).toMatchObject({
      wakeEnabled: false,
      wakePhrase: null,
      pushToTalkMode: "toggle",
    });
    expect(rows.settings[0]?.metadata).toHaveProperty("wakeUnsupportedAt");
  });

  it("persists toggle push-to-talk mode", async () => {
    withAuthEnv();
    const rows = createVoiceRows();
    const app = createVoiceTestApp(createVoiceDependencies({ db: createVoiceDb(rows) }));
    const response = await app.request(`/v1/twins/${TWIN_ID}/voice/settings`, {
      method: "PUT",
      body: JSON.stringify({ pushToTalkMode: "toggle" }),
      headers: await authedHeaders(),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({ pushToTalkMode: "toggle" });
    expect(rows.settings[0]).toMatchObject({ pushToTalkMode: "toggle" });
  });

  it("persists the selected preset voice profile", async () => {
    withAuthEnv();
    const rows = createVoiceRows();
    const app = createVoiceTestApp(createVoiceDependencies({ db: createVoiceDb(rows) }));
    const response = await app.request(`/v1/twins/${TWIN_ID}/voice/profile`, {
      method: "POST",
      body: JSON.stringify({ mode: "preset", presetVoiceId: "focused_analyst" }),
      headers: await authedHeaders(),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      twinId: TWIN_ID,
      mode: "preset",
      presetVoiceId: "focused_analyst",
    });
    expect(rows.profiles[0]).toMatchObject({
      twinId: TWIN_ID,
      mode: "preset",
      presetVoiceId: "focused_analyst",
    });
  });

  it("uses the persisted preset profile for speech when no request override is sent", async () => {
    withAuthEnv();
    const rows = createVoiceRows();
    rows.profiles.push({
      id: "00000000-0000-4000-8000-0000000000cd",
      twinId: TWIN_ID,
      mode: "preset",
      presetVoiceId: "focused_analyst",
      provider: "cartesia",
      referenceArtifactId: null,
      consentAt: null,
      metadata: {},
      createdAt: new Date("2026-06-19T00:00:00.000Z"),
      updatedAt: new Date("2026-06-19T00:00:00.000Z"),
    });
    const synthesize = vi.fn(async () => ({
      audioBytes: new Uint8Array([1, 2, 3]),
      contentType: "audio/wav",
    }));
    const app = createVoiceTestApp(createVoiceDependencies({
      db: createVoiceDb(rows),
      voiceSynthesizer: {
        provider: "cartesia",
        synthesize,
      },
    }));

    const response = await app.request(`/v1/twins/${TWIN_ID}/voice/speak`, {
      method: "POST",
      body: JSON.stringify({ text: "Hello" }),
      headers: await authedHeaders(),
    });

    expect(response.status).toBe(200);
    expect(synthesize).toHaveBeenCalledWith(expect.objectContaining({
      text: "Hello",
      voiceId: "focused_analyst",
    }));
  });
});

function createVoiceTestApp(dependencies: AppDependencies) {
  const app = new Hono();
  app.route("/v1/twins/:twinId/voice", createVoiceRoutes(dependencies));
  return app;
}

function createVoiceDependencies(
  overrides: Partial<AppDependencies> = {},
): AppDependencies {
  return {
    db: createVoiceDb(createVoiceRows()),
    speechToTextTranscriber: {
      transcribe: vi.fn(async () => ({
        text: "Hello",
        provider: "openai",
        model: "gpt-4o-mini-transcribe",
      })),
    },
    ...overrides,
  } as AppDependencies;
}

function createVoiceRows() {
  return {
    twins: [{ id: TWIN_ID, name: "Jarvis" }],
    settings: [] as Array<Record<string, unknown>>,
    profiles: [] as Array<Record<string, unknown>>,
  };
}

function createVoiceDb(rows: ReturnType<typeof createVoiceRows>): AppDependencies["db"] {
  return {
    select: () => ({
      from: (table: unknown) => ({
        where: () => ({
          limit: async () => {
            if (table === twins) {
              return rows.twins;
            }
            if (table === twinVoiceSettings) {
              return rows.settings.slice(0, 1);
            }
            if (table === twinVoiceProfiles) {
              return rows.profiles.slice(0, 1);
            }
            return [];
          },
        }),
      }),
    }),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        if (table === auditEvents) {
          return Promise.resolve();
        }

        if (table === twinVoiceSettings) {
          const row = {
            id: "00000000-0000-4000-8000-0000000000ab",
            createdAt: new Date("2026-06-19T00:00:00.000Z"),
            updatedAt: new Date("2026-06-19T00:00:00.000Z"),
            ...values,
          };
          rows.settings.push(row);
          return { returning: async () => [row] };
        }

        if (table === twinVoiceProfiles) {
          const row = {
            id: "00000000-0000-4000-8000-0000000000ac",
            createdAt: new Date("2026-06-19T00:00:00.000Z"),
            updatedAt: new Date("2026-06-19T00:00:00.000Z"),
            ...values,
          };
          rows.profiles.push(row);
          return { returning: async () => [row] };
        }

        return { returning: async () => [] };
      },
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: () => {
          if (table === twinVoiceSettings && rows.settings[0]) {
            Object.assign(rows.settings[0], values);
            return { returning: async () => [rows.settings[0]] };
          }
          if (table === twinVoiceProfiles && rows.profiles[0]) {
            Object.assign(rows.profiles[0], values);
            return { returning: async () => [rows.profiles[0]] };
          }
          return { returning: async () => [] };
        },
      }),
    }),
    delete: vi.fn(),
  } as never;
}

async function authedHeaders() {
  const token = await signSessionToken(
    {
      type: "user",
      sub: "user-1",
      twinId: TWIN_ID,
      walletAddress: "0xabc",
      scopes: ["memory:read", "artifact:upload"],
    },
    { jwtSecret: "voice-test-secret", tokenIssuer: "voice-test" },
  );

  return {
    "content-type": "application/json",
    authorization: `Bearer ${token}`,
  };
}

function withAuthEnv() {
  process.env["JWT_SECRET"] = "voice-test-secret";
  process.env["TOKEN_ISSUER"] = "voice-test";
}
