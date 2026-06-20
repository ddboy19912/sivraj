import { expect } from "vitest";
import { getHomeAgentState } from "@/lib/twin/visualizer-state";
import { homeSignals } from "@/tests/lib/twin/fixtures";
import { createBootstrap } from "@/tests/fixtures/onboarding-fixtures";

export function runKeepsWalletAuthCalmInIdle() {
  expect(
    getHomeAgentState(
      homeSignals({
        onboarding: {
          currentStep: null,
          isBusy: false,
          onboardingComplete: false,
          completedOnboardingHint: false,
          accessState: { status: "wallet_auth", hasWallet: false, error: null, hasCompletionHint: false },
        },
      }),
    ),
  ).toBe("idle");
}

export function runKeepsActiveOnboardingCalmInIdle() {
  expect(
    getHomeAgentState(
      homeSignals({
        onboarding: {
          currentStep: "name",
          isBusy: false,
          onboardingComplete: false,
          completedOnboardingHint: false,
          accessState: {
            status: "onboarding",
            bootstrap: createBootstrap("not_started"),
          },
        },
      }),
    ),
  ).toBe("idle");
}

export function runKeepsProfileInitializationCalmInIdle() {
  expect(
    getHomeAgentState(
      homeSignals({
        onboarding: {
          currentStep: null,
          isBusy: false,
          onboardingComplete: false,
          completedOnboardingHint: true,
          accessState: {
            status: "pending",
            title: "Loading profile",
            message: "Preparing your twin",
          },
        },
      }),
    ),
  ).toBe("idle");
}

export function runMapsIntroPreparationToThinking() {
  expect(
    getHomeAgentState(
      homeSignals({
        runtimeState: {
          status: "preparing_speech",
          eventId: "event-1",
          dedupeKey: "event-1",
          text: "Hi",
          voiceStyle: "energetic",
          processedEventIds: [],
        },
      }),
    ),
  ).toBe("thinking");
}

export function runMapsIntroSpeechDirectlyToSpeaking() {
  expect(
    getHomeAgentState(
      homeSignals({
        runtimeState: {
          status: "speaking",
          eventId: "event-1",
          dedupeKey: "event-1",
          text: "Hi",
          clips: ["blob:speech"],
          clipCursor: 0,
          streamClosed: true,
          processedEventIds: [],
        },
      }),
    ),
  ).toBe("speaking");
}

export function runMapsCompletedHomeUsageToIdle() {
  expect(getHomeAgentState(homeSignals())).toBe("idle");
}

export function runMapsNonOnboardingBusyWorkToThinking() {
  expect(getHomeAgentState(homeSignals({ onboarding: { ...homeSignals().onboarding, isBusy: true } }))).toBe("thinking");
}

export function runReturnsNullOnNonHomeTabs() {
  expect(getHomeAgentState(homeSignals({ activeTab: "chat" }))).toBeNull();
}
