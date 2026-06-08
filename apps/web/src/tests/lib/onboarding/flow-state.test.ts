import { describe, it } from "vitest";
import type { Session } from "@/lib/session";
import {
  runAllowsProtectedAccessDuringBootstrap,
  runBootsStoredSession,
  runClearsFirstMemoryArtifactOnTextChange,
  runClearsProtectedAccessWithoutWallet,
  runCompletesOnboardingWithoutIntroCue,
  runCommitsOnboardingCompletionWithRuntimeEvent,
  runDoesNotExposeStepAfterCompletion,
  runDoesNotTrustSessionDuringBootstrap,
  runIgnoresPanelDuringBootstrap,
  runKeepsNewWalletsAuthGated,
  runRoutesVerifiedWalletToOnboarding,
  runShowsAuthGateForActiveWalletSignature,
  runShowsAuthGateWithoutWallet,
  runTracksFirstMemoryArtifact,
  runUsesCachedCompletionAsReloadGuard,
} from "@/tests/lib/onboarding/flow-state-scenarios";

const session: Session = {
  token: "token",
  refreshToken: "refresh-token",
  expiresAt: "2026-06-04T20:22:22.384Z",
  twinId: "8bc6a3ac-62af-4a36-9465-3c1a772a95e6",
  walletAddress: "0x9fbc2c08fad314baf33bd2bfbe9b99abc02af176f5e30d52d15fb201b60f237f",
};

describe("onboarding boot", () => {
  it("boots a stored session without showing onboarding before wallet resolution", () => runBootsStoredSession(session));
  it("uses cached completion only as a no-panel reload guard", () => runUsesCachedCompletionAsReloadGuard(session));
});

describe("onboarding wallet auth", () => {
  it("shows the auth gate when no wallet is selected", () => runShowsAuthGateWithoutWallet());
  it("shows the auth gate when the active wallet needs a signature", () => runShowsAuthGateForActiveWalletSignature(session));
  it("keeps new wallets as auth-gated without a completion hint", () => runKeepsNewWalletsAuthGated());
  it("clears protected access when no wallet is connected", () => runClearsProtectedAccessWithoutWallet(session));
});

describe("onboarding completion", () => {
  it("does not expose a current step after explicit onboarding completion", () => runDoesNotExposeStepAfterCompletion(session));
  it("commits onboarding completion with runtime events", () => runCommitsOnboardingCompletionWithRuntimeEvent(session));
  it("completes onboarding without intro playback when the API does not issue a cue", () => runCompletesOnboardingWithoutIntroCue(session));
  it("routes a verified unonboarded wallet into onboarding", () => runRoutesVerifiedWalletToOnboarding(session));
});

describe("onboarding bootstrap", () => {
  it("does not trust a matching stored session while profile bootstrap is pending", () => runDoesNotTrustSessionDuringBootstrap(session));
  it("allows protected access during bootstrap only for cached completed sessions", () => runAllowsProtectedAccessDuringBootstrap(session));
  it("ignores onboarding panel during profile bootstrap", () => runIgnoresPanelDuringBootstrap(session));
});

describe("onboarding first memory", () => {
  it("tracks a stored first memory artifact for profile-completion retry", () => runTracksFirstMemoryArtifact(session));
  it("clears the stored first memory artifact when the memory text changes", () => runClearsFirstMemoryArtifactOnTextChange(session));
});
