import { beforeEach, describe, expect, it } from "vitest";
import type { Session } from "@/lib/session";
import {
  hasCompletedOnboarding,
  hasCompletedOnboardingForWallet,
  markOnboardingCompleted,
  ONBOARDING_COMPLETION_STORAGE_KEY,
} from "@/lib/onboarding/completion";

const session: Session = {
  token: "token",
  refreshToken: "refresh-token",
  expiresAt: "2026-06-04T20:22:22.384Z",
  twinId: "twin-id",
  walletAddress: "0x123",
};

describe("onboarding completion cache", () => {
  beforeEach(() => {
    localStorage.removeItem(ONBOARDING_COMPLETION_STORAGE_KEY);
  });

  it("matches completion by wallet for presentation hints", () => {
    markOnboardingCompleted(session);

    expect(hasCompletedOnboarding(session)).toBe(true);
    expect(hasCompletedOnboardingForWallet("0x0000000000000000000000000000000000000000000000000000000000000123")).toBe(true);
    expect(hasCompletedOnboardingForWallet("0x456")).toBe(false);
  });
});
