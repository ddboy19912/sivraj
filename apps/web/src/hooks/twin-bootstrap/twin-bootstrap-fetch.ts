import { ensureFreshSession, getAuthedJson } from "@/lib/api";
import type { TwinBootstrap } from "@/types/wallet.types";
import type { Session } from "@/lib/session";
import type {
  TwinIdentityProfile,
  TwinProfile,
  VoicePresetResponse,
} from "@/types/onboarding.types";

export async function fetchTwinBootstrap(
  session: Session,
  setSession: (session: Session) => void,
): Promise<TwinBootstrap> {
  const freshSession = await ensureFreshSession(session, setSession);
  const [profile, identity, voiceResponse] = await Promise.all([
    getAuthedJson<TwinProfile>(
      `/v1/twins/${freshSession.twinId}/profile`,
      freshSession,
      setSession,
    ),
    getAuthedJson<TwinIdentityProfile>(
      `/v1/twins/${freshSession.twinId}/identity-profile`,
      freshSession,
      setSession,
    ),
    getAuthedJson<VoicePresetResponse>(
      `/v1/twins/${freshSession.twinId}/voice/presets`,
      freshSession,
      setSession,
    ).catch(() => null),
  ]);

  return { profile, identity, voiceResponse };
}
