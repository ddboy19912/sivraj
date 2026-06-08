import { describe, it } from "vitest";
import {
  runKeepsActiveOnboardingCalmInIdle,
  runKeepsProfileInitializationCalmInIdle,
  runKeepsWalletAuthCalmInIdle,
  runMapsCompletedHomeUsageToInitializing,
  runMapsIntroPreparationToThinking,
  runMapsIntroSpeechDirectlyToSpeaking,
  runMapsNonOnboardingBusyWorkToThinking,
  runReturnsNullOnNonHomeTabs,
} from "@/tests/lib/twin/scenarios";

describe("home agent state wallet auth", () => {
  it("keeps wallet auth calm in idle", () => runKeepsWalletAuthCalmInIdle());
});

describe("home agent state onboarding", () => {
  it("keeps active onboarding calm in idle", () => runKeepsActiveOnboardingCalmInIdle());
});

describe("home agent state bootstrap", () => {
  it("keeps profile initialization calm in idle", () => runKeepsProfileInitializationCalmInIdle());
});

describe("home agent state intro playback", () => {
  it("maps intro preparation to thinking", () => runMapsIntroPreparationToThinking());
  it("maps intro speech directly to speaking", () => runMapsIntroSpeechDirectlyToSpeaking());
});

describe("home agent state completed home", () => {
  it("maps completed home usage to initializing until voice input is implemented", () => runMapsCompletedHomeUsageToInitializing());
  it("maps non-onboarding busy work to thinking", () => runMapsNonOnboardingBusyWorkToThinking());
});

describe("home agent state tabs", () => {
  it("returns null on non-home tabs", () => runReturnsNullOnNonHomeTabs());
});
