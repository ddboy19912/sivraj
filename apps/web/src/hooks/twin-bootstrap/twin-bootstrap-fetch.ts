import { getAuthedJson } from "@/lib/api";
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
  const [profile, identity, voiceResponse] = await Promise.all([
    getAuthedJson<TwinProfile>(
      `/v1/twins/${session.twinId}/profile`,
      session,
      setSession,
    ),
    getAuthedJson<TwinIdentityProfile>(
      `/v1/twins/${session.twinId}/identity-profile`,
      session,
      setSession,
    ),
    getAuthedJson<VoicePresetResponse>(
      `/v1/twins/${session.twinId}/voice/presets`,
      session,
      setSession,
    ).catch(() => null),
  ]);

  return { profile, identity, voiceResponse };
}
