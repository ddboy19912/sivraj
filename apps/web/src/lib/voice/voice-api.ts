import {
  getAuthedJson,
  postAuthedAudio,
  postAuthedJson,
  putAuthedJson,
} from "@/lib/api";
import type { Session } from "@/lib/session";
import type {
  TwinVoiceProfile,
  RealtimeVoiceSynthesisSession,
  VoicePresetResponse,
  RealtimeVoiceTranscriptionSession,
  VoiceSettings,
  VoiceTranscription,
} from "@/types/voice.types";

type SessionHandler = (session: Session) => void;

export function loadVoiceSettings(
  session: Session,
  onSessionRefreshed: SessionHandler,
) {
  return getAuthedJson<VoiceSettings>(
    `/v1/twins/${session.twinId}/voice/settings`,
    session,
    onSessionRefreshed,
  );
}

export function loadVoicePresets(
  session: Session,
  onSessionRefreshed: SessionHandler,
) {
  return getAuthedJson<VoicePresetResponse>(
    `/v1/twins/${session.twinId}/voice/presets`,
    session,
    onSessionRefreshed,
  );
}

export function updateVoiceSettings(
  input: {
    wakeEnabled?: boolean;
    wakePhrase?: string | null;
    clientWakeSupported?: boolean;
  },
  session: Session,
  onSessionRefreshed: SessionHandler,
) {
  return putAuthedJson<VoiceSettings>(
    `/v1/twins/${session.twinId}/voice/settings`,
    input,
    session,
    onSessionRefreshed,
  );
}

export function updatePresetVoiceProfile(
  input: { presetVoiceId: string },
  session: Session,
  onSessionRefreshed: SessionHandler,
) {
  return postAuthedJson<TwinVoiceProfile>(
    `/v1/twins/${session.twinId}/voice/profile`,
    {
      mode: "preset",
      presetVoiceId: input.presetVoiceId,
    },
    session,
    onSessionRefreshed,
  );
}

export function loadVoiceProfile(
  session: Session,
  onSessionRefreshed: SessionHandler,
) {
  return getAuthedJson<TwinVoiceProfile>(
    `/v1/twins/${session.twinId}/voice/profile`,
    session,
    onSessionRefreshed,
  );
}

export function transcribeVoiceAudio(
  input: {
    audioBase64: string;
    mimeType: string;
    fileName: string;
    prompt?: string | null;
  },
  session: Session,
  onSessionRefreshed: SessionHandler,
) {
  return postAuthedJson<VoiceTranscription>(
    `/v1/twins/${session.twinId}/voice/transcribe`,
    input,
    session,
    onSessionRefreshed,
  );
}

// Synthesize a single spoken clip and return an object URL. Used to stream a
// reply sentence-by-sentence so playback can begin before the full answer is
// generated, instead of waiting on one large synthesis request.
export async function synthesizeVoiceClip(
  input: { text: string; style: "energetic"; exaggeration?: number },
  session: Session,
  onSessionRefreshed: SessionHandler,
): Promise<string> {
  const audio = await postAuthedAudio(
    `/v1/twins/${session.twinId}/voice/speak`,
    {
      text: input.text,
      style: input.style,
      exaggeration: input.exaggeration ?? 0.72,
    },
    session,
    onSessionRefreshed,
  );

  return URL.createObjectURL(audio);
}

export function createRealtimeVoiceTranscriptionSession(
  session: Session,
  onSessionRefreshed: SessionHandler,
) {
  return postAuthedJson<RealtimeVoiceTranscriptionSession>(
    `/v1/twins/${session.twinId}/voice/realtime-token`,
    {},
    session,
    onSessionRefreshed,
  );
}

export function createRealtimeVoiceSynthesisSession(
  session: Session,
  onSessionRefreshed: SessionHandler,
) {
  return postAuthedJson<RealtimeVoiceSynthesisSession>(
    `/v1/twins/${session.twinId}/voice/realtime-tts-token`,
    {},
    session,
    onSessionRefreshed,
  );
}
