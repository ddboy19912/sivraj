import { describe, expect, it, vi } from "vitest";
import {
  resolveActiveSession,
  resolveWalletAccessState,
} from "@/hooks/wallet/wallet-access-resolve";
import type { TwinBootstrap } from "@/types/wallet.types";
import type { Session } from "@/lib/session";

const session: Session = {
  token: "token",
  refreshToken: "refresh-token",
  expiresAt: "2026-06-04T20:22:22.384Z",
  twinId: "twin",
  walletAddress: "0x123",
};

const baseSignals = {
  accountSelected: true,
  authError: null,
  bootstrap: null,
  bootstrapError: null,
  hasCompletionHint: false,
  hasMatchingWalletSession: true,
  isBootstrapLoading: false,
  isSigning: false,
  isWalletSettling: false,
  retry: vi.fn(),
  session,
};

describe("resolveWalletAccessState", () => {
  it("starts in pending while the wallet is still settling", () => {
    expect(
      resolveWalletAccessState({
        ...baseSignals,
        accountSelected: false,
        hasMatchingWalletSession: false,
        isWalletSettling: true,
        session: null,
      }).status,
    ).toBe("pending");
  });

  it("requires wallet auth after boot when no wallet is selected", () => {
    const state = resolveWalletAccessState({
      ...baseSignals,
      accountSelected: false,
      hasMatchingWalletSession: false,
      session: null,
    });

    expect(state.status).toBe("wallet_auth");
  });

  it("keeps a matching stored session pending while bootstrap loads", () => {
    const state = resolveWalletAccessState({
      ...baseSignals,
      isBootstrapLoading: true,
    });

    expect(state.status).toBe("pending");
  });

  it("keeps completed app access during a background bootstrap refetch", () => {
    const state = resolveWalletAccessState({
      ...baseSignals,
      bootstrap: createBootstrap("completed"),
      isBootstrapLoading: true,
    });

    expect(state.status).toBe("app_ready");
  });

  it("keeps completed app access during a non-auth bootstrap refresh failure", () => {
    const state = resolveWalletAccessState({
      ...baseSignals,
      bootstrap: createBootstrap("completed"),
      bootstrapError: new Error("Network request failed."),
    });

    expect(state.status).toBe("app_ready");
  });

  it("resolves completed backend bootstrap to app ready", () => {
    const state = resolveWalletAccessState({
      ...baseSignals,
      bootstrap: createBootstrap("completed"),
    });

    expect(state.status).toBe("app_ready");
  });

  it("resolves unfinished backend bootstrap to onboarding", () => {
    const state = resolveWalletAccessState({
      ...baseSignals,
      bootstrap: createBootstrap("not_started"),
    });

    expect(state.status).toBe("onboarding");
  });

  it("maps auth bootstrap failures back to wallet auth", () => {
    const state = resolveWalletAccessState({
      ...baseSignals,
      bootstrapError: new Error("API session is invalid or expired."),
    });

    expect(state.status).toBe("wallet_auth");
  });

  it("surfaces a fatal error when initial bootstrap fails before data is loaded", () => {
    const retry = vi.fn();
    const state = resolveWalletAccessState({
      ...baseSignals,
      bootstrapError: new Error("Network request failed."),
      retry,
    });

    expect(state).toEqual({
      status: "fatal_error",
      title: "Twin initialization failed",
      message: "Network request failed.",
      retry,
    });
  });
});

describe("resolveActiveSession", () => {
  it("does not erase persisted auth while the wallet adapter is settling", () => {
    expect(
      resolveActiveSession({
        selectedWalletAddress: null,
        activeSession: session,
        storedSession: session,
        isWalletSettling: true,
      }),
    ).toEqual({ status: "unchanged" });
  });

  it("clears only active UI session when no wallet is selected after settling", () => {
    expect(
      resolveActiveSession({
        selectedWalletAddress: null,
        activeSession: session,
        storedSession: session,
        isWalletSettling: false,
      }),
    ).toEqual({ status: "clear_active" });
  });

  it("restores a stored session when the selected wallet matches after refresh", () => {
    expect(
      resolveActiveSession({
        selectedWalletAddress: session.walletAddress,
        activeSession: null,
        storedSession: session,
        isWalletSettling: false,
      }),
    ).toEqual({ status: "restore_stored", session });
  });

  it("clears active access without deleting storage when the wallet changes", () => {
    expect(
      resolveActiveSession({
        selectedWalletAddress: "0x456",
        activeSession: session,
        storedSession: session,
        isWalletSettling: false,
      }),
    ).toEqual({ status: "clear_active" });
  });
});

function createBootstrap(
  onboardingStatus: "not_started" | "in_progress" | "completed",
): TwinBootstrap {
  return {
    profile: {
      twinId: "twin",
      name: onboardingStatus === "completed" ? "Jarvis" : "Primary Twin",
    },
    identity: {
      twinId: "twin",
      displayName: null,
      aliases: [],
      emails: [],
      phones: [],
      handles: {},
      selfDescriptionArtifactId: null,
      onboardingStatus,
      firstMeetIntroStatus: onboardingStatus === "completed" ? "consumed" : "not_started",
      shouldPlayFirstMeetIntro: false,
      events: [],
    },
    voiceResponse: null,
  };
}
