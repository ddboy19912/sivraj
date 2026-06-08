import { readFile } from "node:fs/promises";
import { join } from "node:path";
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
import { Hono } from "hono";
import type { Context } from "hono";
import type { AppDependencies } from "../app.js";
import { requireAuth, type AuthEnv } from "../middleware/auth.js";
import { authorizeTwinRoute, type AuthorizedTwin } from "../lib/http/route-auth.js";
import { optionalString, parseJsonObjectBody, readRecord, requiredString } from "../lib/http/route-helpers.js";
import {
  DEFAULT_VOICE_PRESET_ID,
  getVoicePresetsForProvider,
  isVoicePresetId,
  type VoicePreset,
} from "../services/voice-service-client.js";

type VoiceProvider = VoicePreset["provider"];

const FALLBACK_VOICE_PROVIDER: VoiceProvider = "chatterbox_turbo";
const MAX_SPEAK_TEXT_CHARS = 2_000;
const MAX_REFERENCE_AUDIO_BASE64_CHARS = 8 * 1024 * 1024;
const PRESET_PREVIEW_TEXT = "This is how I can sound when we talk.";
const PRESET_PREVIEW_EXTENSIONS = ["wav", "mp3", "webm", "m4a"] as const;
const PRESET_PREVIEW_CONTENT_TYPES: Record<string, string> = {
  wav: "audio/wav",
  mp3: "audio/mpeg",
  webm: "audio/webm",
  m4a: "audio/mp4",
};
const presetPreviewCache = new Map<string, VoicePreviewAudio>();

type VoiceMode = "preset" | "clone";
type VoicePreviewAudio = {
  audioBytes: Uint8Array;
  contentType: string;
};

export function createVoiceRoutes({
  db,
  privateMemoryStorage,
  privateMemoryReader,
  voiceSynthesizer,
  voicePreviewAssetDir,
}: AppDependencies) {
  const routes = new Hono<AuthEnv>();

  routes.get("/presets", requireAuth, async (c) => {
    const routeAuth = authorizeTwinRoute(c);
    if (!routeAuth.ok) {
      return routeAuth.response;
    }
    const gate = routeAuth.value;

    return c.json({
      defaultVoiceId: DEFAULT_VOICE_PRESET_ID,
      presets: getVoicePresetsForProvider(readActiveVoiceProvider(voiceSynthesizer)),
    });
  });

  routes.get("/presets/:voiceId/preview", requireAuth, async (c) => {
    const routeAuth = authorizeTwinRoute(c);
    if (!routeAuth.ok) {
      return routeAuth.response;
    }

    return servePresetPreview(c, {
      voiceId: c.req.param("voiceId"),
      voicePreviewAssetDir,
      voiceSynthesizer,
    });
  });

  routes.get("/profile", requireAuth, async (c) => {
    const routeAuth = authorizeTwinRoute(c);
    if (!routeAuth.ok) {
      return routeAuth.response;
    }
    const gate = routeAuth.value;

    const profile = await loadVoiceProfile(db, gate.twinId);
    return c.json(formatVoiceProfile(gate.twinId, profile));
  });

  routes.post("/profile", requireAuth, async (c) => {
    const routeAuth = authorizeTwinRoute(c, "artifact:upload");
    if (!routeAuth.ok) {
      return routeAuth.response;
    }

    return saveVoiceProfile(c, {
      db,
      privateMemoryStorage,
      voiceSynthesizer,
      gate: routeAuth.value,
    });
  });

  routes.post("/speak", requireAuth, async (c) => {
    const routeAuth = authorizeTwinRoute(c);
    if (!routeAuth.ok) {
      return routeAuth.response;
    }

    return speakWithVoice(c, {
      db,
      privateMemoryReader,
      voiceSynthesizer,
      gate: routeAuth.value,
    });
  });

  return routes;
}

type VoiceRouteDeps = {
  db: AppDependencies["db"];
  privateMemoryStorage: AppDependencies["privateMemoryStorage"];
  privateMemoryReader: AppDependencies["privateMemoryReader"];
  voiceSynthesizer: AppDependencies["voiceSynthesizer"];
  gate: AuthorizedTwin;
};

async function saveVoiceProfile(
  c: Context<AuthEnv>,
  { db, privateMemoryStorage, voiceSynthesizer, gate }: Pick<VoiceRouteDeps, "db" | "privateMemoryStorage" | "voiceSynthesizer" | "gate">,
) {
  const parsedBody = await parseJsonObjectBody(c);
  if (!parsedBody.ok) {
    return parsedBody.response;
  }

  const mode = readVoiceMode(parsedBody.body["mode"]);
  if (!mode) {
    return c.json({ error: "invalid_voice_mode" }, 400);
  }

  if (mode === "preset") {
    return savePresetVoiceProfile(c, { db, voiceSynthesizer, gate, payload: parsedBody.body });
  }

  return saveCloneVoiceProfile(c, {
    db,
    privateMemoryStorage,
    voiceSynthesizer,
    gate,
    payload: parsedBody.body,
  });
}

async function savePresetVoiceProfile(
  c: Context<AuthEnv>,
  input: {
    db: AppDependencies["db"];
    voiceSynthesizer: AppDependencies["voiceSynthesizer"];
    gate: AuthorizedTwin;
    payload: Record<string, unknown>;
  },
) {
  const presetVoiceId = optionalString(input.payload["presetVoiceId"]) ?? DEFAULT_VOICE_PRESET_ID;
  if (!isVoicePresetId(presetVoiceId)) {
    return c.json({ error: "invalid_voice_preset" }, 400);
  }

  const provider = readActiveVoiceProvider(input.voiceSynthesizer);
  const profile = await upsertVoiceProfile(input.db, {
    twinId: input.gate.twinId,
    mode: "preset",
    presetVoiceId,
    referenceArtifactId: null,
    consentAt: null,
    provider,
    metadata: { selectedAt: new Date().toISOString() },
  });

  await auditVoiceProfileUpdated(input.db, {
    twinId: input.gate.twinId,
    actorType: input.gate.auth.type,
    actorId: input.gate.auth.sub,
    profileId: profile.id,
    mode: "preset",
    presetVoiceId,
    provider,
  });

  return c.json(formatVoiceProfile(input.gate.twinId, profile));
}

function validateCloneVoicePayload(
  payload: Record<string, unknown>,
  privateMemoryStorage: AppDependencies["privateMemoryStorage"],
):
  | { ok: true; audioBase64: string; fileName: string; mimeType: string; language: string }
  | { ok: false; error: string; status: 400 | 413 | 503 } {
  if (payload["consent"] !== true) {
    return { ok: false, error: "voice_clone_consent_required", status: 400 };
  }

  const audioBase64 = requiredString(payload["audioBase64"]);
  if (!audioBase64) {
    return { ok: false, error: "missing_voice_reference_audio", status: 400 };
  }

  if (audioBase64.length > MAX_REFERENCE_AUDIO_BASE64_CHARS) {
    return { ok: false, error: "voice_reference_audio_too_large", status: 413 };
  }

  if (!privateMemoryStorage) {
    return { ok: false, error: "encrypted_storage_not_configured", status: 503 };
  }

  return {
    ok: true,
    audioBase64,
    fileName: optionalString(payload["fileName"]) ?? `voice-profile-${new Date().toISOString()}.webm`,
    mimeType: optionalString(payload["mimeType"]) ?? "audio/webm",
    language: optionalString(payload["language"]) ?? "en",
  };
}

async function persistCloneVoiceReference(input: {
  db: AppDependencies["db"];
  privateMemoryStorage: NonNullable<AppDependencies["privateMemoryStorage"]>;
  twinId: string;
  audioBase64: string;
  fileName: string;
  mimeType: string;
}) {
  const consentAt = new Date();
  const stored = await input.privateMemoryStorage.storePrivateMemory({
    twinId: input.twinId,
    sourceType: "voice_note",
    title: "Sivraj voice profile reference",
    content: input.audioBase64,
    metadata: {
      uploadKind: "voice_profile_reference",
      fileType: input.mimeType,
      fileName: input.fileName,
      encoding: "base64",
      consent: { ownVoice: true, consentAt: consentAt.toISOString() },
    },
  }).catch((error: unknown) => {
    console.error("voice profile encrypted storage failed", error);
    return null;
  });

  if (!stored) {
    return null;
  }

  const [artifact] = await input.db
    .insert(sourceArtifacts)
    .values({
      twinId: input.twinId,
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

  return { artifact, consentAt };
}

async function saveCloneVoiceProfile(
  c: Context<AuthEnv>,
  input: Pick<VoiceRouteDeps, "db" | "privateMemoryStorage" | "voiceSynthesizer" | "gate"> & {
    payload: Record<string, unknown>;
  },
) {
  const validated = validateCloneVoicePayload(input.payload, input.privateMemoryStorage);
  if (!validated.ok) {
    return c.json({ error: validated.error }, validated.status);
  }

  const persisted = await persistCloneVoiceReference({
    db: input.db,
    privateMemoryStorage: input.privateMemoryStorage!,
    twinId: input.gate.twinId,
    audioBase64: validated.audioBase64,
    fileName: validated.fileName,
    mimeType: validated.mimeType,
  });

  if (!persisted) {
    return c.json({ error: "encrypted_storage_failed" }, 503);
  }

  const provider = readActiveVoiceProvider(input.voiceSynthesizer);
  const profile = await upsertVoiceProfile(input.db, {
    twinId: input.gate.twinId,
    mode: "clone",
    presetVoiceId: "custom_clone",
    referenceArtifactId: persisted.artifact.id,
    consentAt: persisted.consentAt,
    provider,
    metadata: {
      fileType: validated.mimeType,
      consentAt: persisted.consentAt.toISOString(),
      providerCloneStatus: input.voiceSynthesizer?.cloneVoice ? "pending" : "not_configured",
    },
  });

  if (input.voiceSynthesizer?.cloneVoice) {
    attachProviderVoiceClone({
      db: input.db,
      voiceSynthesizer: input.voiceSynthesizer,
      twinId: input.gate.twinId,
      profileId: profile.id,
      audioBase64: validated.audioBase64,
      mimeType: validated.mimeType,
      fileName: validated.fileName,
      language: validated.language,
      metadata: profile.metadata,
    });
  }

  writeVoiceAuditEvent(input.db, {
    twinId: input.gate.twinId,
    actorType: input.gate.auth.type,
    actorId: input.gate.auth.sub,
    eventType: "voice_profile.reference_stored",
    resourceType: "source_artifact",
    resourceId: persisted.artifact.id,
    metadata: {
      profileId: profile.id,
      storageMode: ENCRYPTED_WALRUS_STORAGE_MODE,
      consentAt: persisted.consentAt.toISOString(),
    },
  });
  await auditVoiceProfileUpdated(input.db, {
    twinId: input.gate.twinId,
    actorType: input.gate.auth.type,
    actorId: input.gate.auth.sub,
    profileId: profile.id,
    mode: "clone",
    presetVoiceId: "custom_clone",
    provider,
  });

  return c.json(formatVoiceProfile(input.gate.twinId, profile), 201);
}

async function speakWithVoice(
  c: Context<AuthEnv>,
  { db, privateMemoryReader, voiceSynthesizer, gate }: Pick<VoiceRouteDeps, "db" | "privateMemoryReader" | "voiceSynthesizer" | "gate">,
) {
  const parsedBody = await parseJsonObjectBody(c);
  if (!parsedBody.ok) {
    return parsedBody.response;
  }

  const text = requiredString(parsedBody.body["text"]);
  if (!text) {
    return c.json({ error: "missing_text" }, 400);
  }

  if (text.length > MAX_SPEAK_TEXT_CHARS) {
    return c.json({ error: "text_too_long" }, 413);
  }

  if (!voiceSynthesizer) {
    return c.json({ error: "voice_service_not_configured" }, 503);
  }

  const voiceSelection = await resolveSpeakVoiceSelection({
    db,
    privateMemoryReader,
    twinId: gate.twinId,
    payload: parsedBody.body,
  });

  if ("error" in voiceSelection) {
    return c.json({ error: voiceSelection.error }, voiceSelection.status);
  }

  const audio = await voiceSynthesizer.synthesize({
    text,
    voiceId: voiceSelection.voiceId,
    language: optionalString(parsedBody.body["language"]) ?? "en",
    style: optionalString(parsedBody.body["style"]) ?? undefined,
    exaggeration: optionalNumber(parsedBody.body["exaggeration"]),
    referenceAudioBase64: voiceSelection.referenceAudioBase64,
    referenceMimeType: voiceSelection.referenceMimeType,
    providerVoiceId: voiceSelection.providerVoiceId,
  }).catch((error: unknown) => {
    console.error("voice synthesis failed", error);
    return null;
  });

  if (!audio) {
    return c.json({ error: "voice_service_unavailable" }, 503);
  }

  return audioResponse(
    { audioBytes: audio.audioBytes, contentType: audio.contentType },
    "no-store",
  );
}

type SpeakVoiceSelection =
  | {
      voiceId: string;
      referenceAudioBase64?: string;
      referenceMimeType?: string | null;
      providerVoiceId?: string | null;
    }
  | { error: string; status: 400 | 503 };

async function resolveSpeakVoiceSelection(input: {
  db: AppDependencies["db"];
  privateMemoryReader: AppDependencies["privateMemoryReader"];
  twinId: string;
  payload: Record<string, unknown>;
}): Promise<SpeakVoiceSelection> {
  const selectedProfile = await loadVoiceProfile(input.db, input.twinId);
  const requestedVoiceId = optionalString(input.payload["voiceId"]);
  const profile = formatVoiceProfile(input.twinId, selectedProfile);

  if (requestedVoiceId && !isVoicePresetId(requestedVoiceId)) {
    return { error: "invalid_voice_preset", status: 400 };
  }

  if (requestedVoiceId || profile.mode !== "clone") {
    return { voiceId: requestedVoiceId ?? profile.presetVoiceId };
  }

  const providerVoiceId = readMetadataString(profile.metadata, "providerVoiceId");
  if (providerVoiceId) {
    return { voiceId: "custom_clone", providerVoiceId };
  }

  const referenceAudio = await loadCloneReferenceAudio({
    db: input.db,
    privateMemoryReader: input.privateMemoryReader,
    twinId: input.twinId,
    profile,
  });

  if ("error" in referenceAudio) {
    return referenceAudio;
  }

  return {
    voiceId: "custom_clone",
    referenceAudioBase64: referenceAudio.referenceAudioBase64,
    referenceMimeType: referenceAudio.referenceMimeType,
  };
}

async function loadCloneReferenceAudio(input: {
  db: AppDependencies["db"];
  privateMemoryReader: AppDependencies["privateMemoryReader"];
  twinId: string;
  profile: ReturnType<typeof formatVoiceProfile>;
}): Promise<
  | { referenceAudioBase64: string; referenceMimeType: string | null | undefined }
  | { error: string; status: 503 }
> {
  if (!input.privateMemoryReader || !input.profile.referenceArtifactId) {
    return { error: "voice_reference_unavailable", status: 503 };
  }

  const [artifact] = await input.db
    .select()
    .from(sourceArtifacts)
    .where(eq(sourceArtifacts.id, input.profile.referenceArtifactId))
    .limit(1);

  if (!artifact?.rawStorageRef) {
    return { error: "voice_reference_unavailable", status: 503 };
  }

  const privatePayload = await input.privateMemoryReader.readPrivateMemory({
    rawStorageRef: artifact.rawStorageRef,
    artifactId: artifact.id,
    twinId: input.twinId,
    expectedCiphertextSha256: readCiphertextSha256(artifact.metadata),
  }).catch((error: unknown) => {
    console.error("voice reference read failed", error);
    return undefined;
  });

  const referenceAudioBase64 = extractPrivatePayloadContent(privatePayload);
  if (!referenceAudioBase64) {
    return { error: "voice_reference_unavailable", status: 503 };
  }

  return {
    referenceAudioBase64,
    referenceMimeType: readMetadataString(input.profile.metadata, "fileType"),
  };
}

async function servePresetPreview(
  c: Context<AuthEnv>,
  input: {
    voiceId: string;
    voicePreviewAssetDir?: string;
    voiceSynthesizer: AppDependencies["voiceSynthesizer"];
  },
) {
  if (!isVoicePresetId(input.voiceId)) {
    return c.json({ error: "invalid_voice_preset" }, 400);
  }

  const provider = readActiveVoiceProvider(input.voiceSynthesizer);
  const cacheKey = `${provider}:${input.voiceId}`;
  const cached = presetPreviewCache.get(cacheKey);
  if (cached) {
    return audioResponse(cached, "public, max-age=86400");
  }

  const staticPreview = await readPresetPreviewAsset({
    assetDir: input.voicePreviewAssetDir,
    provider,
    voiceId: input.voiceId,
  });
  if (staticPreview) {
    presetPreviewCache.set(cacheKey, staticPreview);
    return audioResponse(staticPreview, "public, max-age=31536000, immutable");
  }

  return synthesizePresetPreview(c, {
    provider,
    voiceId: input.voiceId,
    cacheKey,
    voiceSynthesizer: input.voiceSynthesizer,
  });
}

async function synthesizePresetPreview(
  c: Context<AuthEnv>,
  input: {
    provider: VoiceProvider;
    voiceId: string;
    cacheKey: string;
    voiceSynthesizer: AppDependencies["voiceSynthesizer"];
  },
) {
  if (!input.voiceSynthesizer) {
    return c.json({ error: "voice_service_not_configured" }, 503);
  }

  const preset = getVoicePresetsForProvider(input.provider).find(
    (candidate) => candidate.id === input.voiceId,
  );
  const audio = await input.voiceSynthesizer.synthesize({
    text: PRESET_PREVIEW_TEXT,
    voiceId: input.voiceId,
    language: preset?.language ?? "en",
    style: preset?.style,
  }).catch((error: unknown) => {
    console.error("voice preset preview synthesis failed", error);
    return null;
  });

  if (!audio) {
    return c.json({ error: "voice_service_unavailable" }, 503);
  }

  const preview = { audioBytes: audio.audioBytes, contentType: audio.contentType };
  presetPreviewCache.set(input.cacheKey, preview);
  return audioResponse(preview, "public, max-age=86400");
}

function audioResponse(audio: VoicePreviewAudio, cacheControl: string) {
  const audioBody = audio.audioBytes.buffer.slice(
    audio.audioBytes.byteOffset,
    audio.audioBytes.byteOffset + audio.audioBytes.byteLength,
  ) as ArrayBuffer;

  return new Response(audioBody, {
    headers: {
      "content-type": audio.contentType,
      "cache-control": cacheControl,
    },
  });
}

async function readPresetPreviewAsset(input: {
  assetDir?: string;
  provider: string;
  voiceId: string;
}): Promise<VoicePreviewAudio | null> {
  if (!input.assetDir) {
    return null;
  }

  for (const extension of PRESET_PREVIEW_EXTENSIONS) {
    const audioBytes = await readFile(
      join(input.assetDir, input.provider, `${input.voiceId}.${extension}`),
    ).catch(() => null);

    if (audioBytes) {
      return {
        audioBytes: new Uint8Array(audioBytes),
        contentType: PRESET_PREVIEW_CONTENT_TYPES[extension],
      };
    }
  }

  return null;
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
  writeVoiceAuditEvent(db, {
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

function writeVoiceAuditEvent(
  db: AppDependencies["db"],
  event: typeof auditEvents.$inferInsert,
) {
  void Promise.resolve(db.insert(auditEvents).values(event)).catch(
    (error: unknown) => {
      console.error("voice audit write failed", error);
    },
  );
}

function attachProviderVoiceClone(input: {
  db: AppDependencies["db"];
  voiceSynthesizer: NonNullable<AppDependencies["voiceSynthesizer"]>;
  twinId: string;
  profileId: string;
  audioBase64: string;
  mimeType: string;
  fileName: string;
  language: string;
  metadata: unknown;
}) {
  void input.voiceSynthesizer.cloneVoice?.({
    audioBase64: input.audioBase64,
    mimeType: input.mimeType,
    fileName: input.fileName,
    name: `Sivraj voice clone ${input.twinId}`,
    description: "User-consented Sivraj AI Twin voice clone.",
    language: input.language,
  })
    .then((clonedVoice) =>
      input.db
        .update(twinVoiceProfiles)
        .set({
          metadata: {
            ...readRecord(input.metadata),
            providerVoiceId: clonedVoice.providerVoiceId,
            provider: "cartesia",
            providerCloneStatus: "ready",
            providerCloneReadyAt: new Date().toISOString(),
          },
          updatedAt: new Date(),
        })
        .where(eq(twinVoiceProfiles.id, input.profileId)),
    )
    .catch((error: unknown) => {
      console.error("voice clone provider setup failed", error);
      void Promise.resolve(
        input.db
          .update(twinVoiceProfiles)
          .set({
            metadata: {
              ...readRecord(input.metadata),
              providerCloneStatus: "failed",
              providerCloneFailedAt: new Date().toISOString(),
            },
            updatedAt: new Date(),
          })
          .where(eq(twinVoiceProfiles.id, input.profileId)),
      ).catch((updateError: unknown) => {
        console.error("voice clone provider failure metadata update failed", updateError);
      });
    });
}

function readActiveVoiceProvider(
  voiceSynthesizer: AppDependencies["voiceSynthesizer"],
): VoiceProvider {
  return voiceSynthesizer?.provider ?? FALLBACK_VOICE_PROVIDER;
}

function readVoiceMode(value: unknown): VoiceMode | null {
  return value === "preset" || value === "clone" ? value : null;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
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
