import {
  auditEvents,
  sourceArtifacts,
  twinVoiceProfiles,
} from "@sivraj/db";
import {
  DEFAULT_MANUAL_MEMORY_SENSITIVITY,
  ENCRYPTED_WALRUS_STORAGE_MODE,
} from "@sivraj/core";
import { eq } from "drizzle-orm";
import type { Context } from "hono";
import { Hono } from "hono";
import type { AppDependencies } from "../app.js";
import { requireAuth, requireScope, type AuthEnv } from "../middleware/auth.js";
import {
  DEFAULT_VOICE_PRESET_ID,
  VOICE_PRESETS,
  getVoicePresetsForProvider,
  isVoicePresetId,
} from "../services/voice-service-client.js";

const FALLBACK_VOICE_PROVIDER = "chatterbox_turbo";
const MAX_SPEAK_TEXT_CHARS = 2_000;
const MAX_REFERENCE_AUDIO_BASE64_CHARS = 8 * 1024 * 1024;

type VoiceMode = "preset" | "clone";

export function createVoiceRoutes({
  db,
  privateMemoryStorage,
  privateMemoryReader,
  voiceSynthesizer,
}: AppDependencies) {
  const routes = new Hono<AuthEnv>();

  routes.get("/presets", requireAuth, async (c) => {
    const gate = authorizeTwin(c);
    if ("response" in gate) {
      return gate.response;
    }

    return c.json({
      defaultVoiceId: DEFAULT_VOICE_PRESET_ID,
      presets: getVoicePresetsForProvider(readActiveVoiceProvider(voiceSynthesizer)),
    });
  });

  routes.get("/profile", requireAuth, async (c) => {
    const gate = authorizeTwin(c);
    if ("response" in gate) {
      return gate.response;
    }

    const profile = await loadVoiceProfile(db, gate.twinId);
    return c.json(formatVoiceProfile(gate.twinId, profile));
  });

  routes.post("/profile", requireAuth, async (c) => {
    const scopeError = requireScope(c, "artifact:upload");
    if (scopeError) {
      return scopeError;
    }

    const gate = authorizeTwin(c);
    if ("response" in gate) {
      return gate.response;
    }

    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return c.json({ error: "invalid_json_body" }, 400);
    }

    const payload = body as Record<string, unknown>;
    const mode = readVoiceMode(payload["mode"]);
    if (!mode) {
      return c.json({ error: "invalid_voice_mode" }, 400);
    }

    if (mode === "preset") {
      const presetVoiceId = optionalString(payload["presetVoiceId"]) ?? DEFAULT_VOICE_PRESET_ID;
      if (!isVoicePresetId(presetVoiceId)) {
        return c.json({ error: "invalid_voice_preset" }, 400);
      }

      const profile = await upsertVoiceProfile(db, {
        twinId: gate.twinId,
        mode,
        presetVoiceId,
        referenceArtifactId: null,
        consentAt: null,
        provider: readActiveVoiceProvider(voiceSynthesizer),
        metadata: {
          selectedAt: new Date().toISOString(),
        },
      });

      await auditVoiceProfileUpdated(db, {
        twinId: gate.twinId,
        actorType: gate.auth.type,
        actorId: gate.auth.sub,
        profileId: profile.id,
        mode,
        presetVoiceId,
        provider: readActiveVoiceProvider(voiceSynthesizer),
      });

      return c.json(formatVoiceProfile(gate.twinId, profile));
    }

    if (payload["consent"] !== true) {
      return c.json({ error: "voice_clone_consent_required" }, 400);
    }

    const audioBase64 = requiredString(payload["audioBase64"]);
    if (!audioBase64) {
      return c.json({ error: "missing_voice_reference_audio" }, 400);
    }

    if (audioBase64.length > MAX_REFERENCE_AUDIO_BASE64_CHARS) {
      return c.json({ error: "voice_reference_audio_too_large" }, 413);
    }

    if (!privateMemoryStorage) {
      return c.json({ error: "encrypted_storage_not_configured" }, 503);
    }

    const fileName = optionalString(payload["fileName"]) ?? `voice-profile-${new Date().toISOString()}.webm`;
    const mimeType = optionalString(payload["mimeType"]) ?? "audio/webm";
    const consentAt = new Date();
    const clonedVoice = voiceSynthesizer?.cloneVoice
      ? await voiceSynthesizer.cloneVoice({
          audioBase64,
          mimeType,
          fileName,
          name: `Sivraj voice clone ${gate.twinId}`,
          description: "User-consented Sivraj AI Twin voice clone.",
          language: optionalString(payload["language"]) ?? "en",
        }).catch((error: unknown) => {
          console.error("voice clone provider setup failed", error);
          return null;
        })
      : null;

    if (voiceSynthesizer?.cloneVoice && !clonedVoice) {
      return c.json({ error: "voice_clone_provider_failed" }, 503);
    }

    const stored = await privateMemoryStorage.storePrivateMemory({
      twinId: gate.twinId,
      sourceType: "voice_note",
      title: "Sivraj voice profile reference",
      content: audioBase64,
      metadata: {
        uploadKind: "voice_profile_reference",
        fileType: mimeType,
        fileName,
        encoding: "base64",
        consent: {
          ownVoice: true,
          consentAt: consentAt.toISOString(),
        },
      },
    }).catch((error: unknown) => {
      console.error("voice profile encrypted storage failed", error);
      return null;
    });

    if (!stored) {
      return c.json({ error: "encrypted_storage_failed" }, 503);
    }

    const [artifact] = await db
      .insert(sourceArtifacts)
      .values({
        twinId: gate.twinId,
        sourceType: "voice_note",
        rawStorageRef: stored.rawStorageRef,
        metadata: {
          uploadKind: "voice_profile_reference",
          storageMode: ENCRYPTED_WALRUS_STORAGE_MODE,
          sensitivity: DEFAULT_MANUAL_MEMORY_SENSITIVITY,
          ciphertextSha256: stored.ciphertextSha256,
          seal: stored.seal,
          walrus: stored.walrus,
          consentAt: consentAt.toISOString(),
        },
        ingestionStatus: "completed",
      })
      .returning();

    const profile = await upsertVoiceProfile(db, {
      twinId: gate.twinId,
      mode,
      presetVoiceId: "custom_clone",
      referenceArtifactId: artifact.id,
      consentAt,
      provider: readActiveVoiceProvider(voiceSynthesizer),
      metadata: {
        fileType: mimeType,
        consentAt: consentAt.toISOString(),
        ...(clonedVoice
          ? {
              providerVoiceId: clonedVoice.providerVoiceId,
              provider: "cartesia",
            }
          : {}),
      },
    });

    await db.insert(auditEvents).values({
      twinId: gate.twinId,
      actorType: gate.auth.type,
      actorId: gate.auth.sub,
      eventType: "voice_profile.reference_stored",
      resourceType: "source_artifact",
      resourceId: artifact.id,
      metadata: {
        profileId: profile.id,
        storageMode: ENCRYPTED_WALRUS_STORAGE_MODE,
        consentAt: consentAt.toISOString(),
      },
    });
    await auditVoiceProfileUpdated(db, {
      twinId: gate.twinId,
      actorType: gate.auth.type,
      actorId: gate.auth.sub,
      profileId: profile.id,
      mode,
      presetVoiceId: "custom_clone",
      provider: readActiveVoiceProvider(voiceSynthesizer),
    });

    return c.json(formatVoiceProfile(gate.twinId, profile), 201);
  });

  routes.post("/speak", requireAuth, async (c) => {
    const gate = authorizeTwin(c);
    if ("response" in gate) {
      return gate.response;
    }

    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return c.json({ error: "invalid_json_body" }, 400);
    }

    const payload = body as Record<string, unknown>;
    const text = requiredString(payload["text"]);
    if (!text) {
      return c.json({ error: "missing_text" }, 400);
    }

    if (text.length > MAX_SPEAK_TEXT_CHARS) {
      return c.json({ error: "text_too_long" }, 413);
    }

    if (!voiceSynthesizer) {
      return c.json({ error: "voice_service_not_configured" }, 503);
    }

    const selectedProfile = await loadVoiceProfile(db, gate.twinId);
    const requestedVoiceId = optionalString(payload["voiceId"]);
    const profile = formatVoiceProfile(gate.twinId, selectedProfile);
    let voiceId = requestedVoiceId ?? profile.presetVoiceId;
    let referenceAudioBase64: string | undefined;
    let referenceMimeType: string | null | undefined;
    let providerVoiceId: string | null | undefined;

    if (requestedVoiceId && !isVoicePresetId(requestedVoiceId)) {
      return c.json({ error: "invalid_voice_preset" }, 400);
    }

    if (!requestedVoiceId && profile.mode === "clone") {
      providerVoiceId = readMetadataString(profile.metadata, "providerVoiceId");
      if (providerVoiceId) {
        voiceId = "custom_clone";
      } else {
        if (!privateMemoryReader || !profile.referenceArtifactId) {
          return c.json({ error: "voice_reference_unavailable" }, 503);
        }

        const [artifact] = await db
          .select()
          .from(sourceArtifacts)
          .where(eq(sourceArtifacts.id, profile.referenceArtifactId))
          .limit(1);

        if (!artifact?.rawStorageRef) {
          return c.json({ error: "voice_reference_unavailable" }, 503);
        }

        const privatePayload = await privateMemoryReader.readPrivateMemory({
          rawStorageRef: artifact.rawStorageRef,
          artifactId: artifact.id,
          twinId: gate.twinId,
          expectedCiphertextSha256: readCiphertextSha256(artifact.metadata),
        }).catch((error: unknown) => {
          console.error("voice reference read failed", error);
          return undefined;
        });

        referenceAudioBase64 = extractPrivatePayloadContent(privatePayload);
        if (!referenceAudioBase64) {
          return c.json({ error: "voice_reference_unavailable" }, 503);
        }

        voiceId = "custom_clone";
        referenceMimeType = readMetadataString(profile.metadata, "fileType");
      }
    }

    const audio = await voiceSynthesizer.synthesize({
      text,
      voiceId,
      language: optionalString(payload["language"]) ?? "en",
      style: optionalString(payload["style"]) ?? undefined,
      exaggeration: optionalNumber(payload["exaggeration"]),
      referenceAudioBase64,
      referenceMimeType,
      providerVoiceId,
    }).catch((error: unknown) => {
      console.error("voice synthesis failed", error);
      return null;
    });

    if (!audio) {
      return c.json({ error: "voice_service_unavailable" }, 503);
    }

    const audioBody = audio.audioBytes.buffer.slice(
      audio.audioBytes.byteOffset,
      audio.audioBytes.byteOffset + audio.audioBytes.byteLength,
    ) as ArrayBuffer;

    return new Response(audioBody, {
      headers: {
        "content-type": audio.contentType,
        "cache-control": "no-store",
      },
    });
  });

  return routes;
}

function authorizeTwin(c: Context<AuthEnv>) {
  const auth = c.get("auth");
  const twinId = c.req.param("twinId");

  if (!twinId) {
    return { response: c.json({ error: "missing_twin_id" }, 400) };
  }

  if (auth.type !== "service" && auth.twinId !== twinId) {
    return { response: c.json({ error: "twin_scope_mismatch" }, 403) };
  }

  return { auth, twinId };
}

async function loadVoiceProfile(db: AppDependencies["db"], twinId: string) {
  const [profile] = await db
    .select()
    .from(twinVoiceProfiles)
    .where(eq(twinVoiceProfiles.twinId, twinId))
    .limit(1);

  return profile ?? null;
}

async function upsertVoiceProfile(
  db: AppDependencies["db"],
  input: {
    twinId: string;
    mode: VoiceMode;
    presetVoiceId: string;
    referenceArtifactId: string | null;
    consentAt: Date | null;
    metadata: Record<string, unknown>;
    provider?: string;
  },
) {
  const existing = await loadVoiceProfile(db, input.twinId);
  const values = {
    mode: input.mode,
    presetVoiceId: input.presetVoiceId,
    provider: input.provider ?? FALLBACK_VOICE_PROVIDER,
    referenceArtifactId: input.referenceArtifactId,
    consentAt: input.consentAt,
    metadata: input.metadata,
    updatedAt: new Date(),
  };

  const [profile] = existing
    ? await db
        .update(twinVoiceProfiles)
        .set(values)
        .where(eq(twinVoiceProfiles.twinId, input.twinId))
        .returning()
    : await db
        .insert(twinVoiceProfiles)
        .values({
          twinId: input.twinId,
          ...values,
        })
        .returning();

  return profile;
}

function formatVoiceProfile(twinId: string, profile: unknown) {
  const record = profile && typeof profile === "object"
    ? profile as Record<string, unknown>
    : {};
  const mode = readVoiceMode(record["mode"]) ?? "preset";
  const presetVoiceId = optionalString(record["presetVoiceId"] ?? record["preset_voice_id"]) ?? DEFAULT_VOICE_PRESET_ID;

  return {
    twinId,
    mode,
    presetVoiceId,
    provider: optionalString(record["provider"]) ?? FALLBACK_VOICE_PROVIDER,
    referenceArtifactId: optionalString(record["referenceArtifactId"] ?? record["reference_artifact_id"]),
    consentAt: formatDate(record["consentAt"] ?? record["consent_at"]),
    metadata: readRecord(record["metadata"]),
  };
}

async function auditVoiceProfileUpdated(
  db: AppDependencies["db"],
  input: {
    twinId: string;
    actorType: string;
    actorId: string;
    profileId: string;
    mode: VoiceMode;
    presetVoiceId: string;
    provider?: string;
  },
) {
  await db.insert(auditEvents).values({
    twinId: input.twinId,
    actorType: input.actorType,
    actorId: input.actorId,
    eventType: "voice_profile.updated",
    resourceType: "twin_voice_profile",
    resourceId: input.profileId,
    metadata: {
      mode: input.mode,
      presetVoiceId: input.presetVoiceId,
      provider: input.provider ?? FALLBACK_VOICE_PROVIDER,
    },
  });
}

function readActiveVoiceProvider(voiceSynthesizer: AppDependencies["voiceSynthesizer"]) {
  return voiceSynthesizer?.provider ?? FALLBACK_VOICE_PROVIDER;
}

function readVoiceMode(value: unknown): VoiceMode | null {
  return value === "preset" || value === "clone" ? value : null;
}

function requiredString(value: unknown): string | null {
  const text = optionalString(value);
  return text && text.length > 0 ? text : null;
}

function optionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readMetadataString(metadata: unknown, key: string): string | null {
  return optionalString(readRecord(metadata)[key]);
}

function readCiphertextSha256(metadata: unknown): string | null {
  return readMetadataString(metadata, "ciphertextSha256");
}

function formatDate(value: unknown): string | null {
  if (value instanceof Date) {
    return value.toISOString();
  }

  return optionalString(value);
}

function extractPrivatePayloadContent(payload: string | undefined): string | undefined {
  if (!payload) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(payload) as { content?: unknown };
    return typeof parsed.content === "string" && parsed.content.length > 0
      ? parsed.content
      : undefined;
  } catch {
    return undefined;
  }
}
