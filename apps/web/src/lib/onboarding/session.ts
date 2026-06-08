import { normalizeSuiAddress } from "@mysten/sui/utils";
import type { Session } from "@/lib/session";
import type { VerifyResponse } from "@/types/onboarding.types";

export function addressesMatch(first?: string | null, second?: string | null) {
  if (!first || !second) {
    return false;
  }

  return normalizeSuiAddress(first) === normalizeSuiAddress(second);
}

export function toSession(verified: VerifyResponse): Session {
  return {
    token: verified.token,
    refreshToken: verified.refreshToken,
    expiresAt: verified.expiresAt,
    twinId: verified.twinId,
    walletAddress: verified.walletAddress,
  };
}
