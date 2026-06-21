import { expect } from "vitest";
import type { Session } from "@/lib/session";
import {
  createInitialState,
  onboardingReducer,
} from "@/lib/onboarding/flow-reducer";
import {
  canUseProtectedApp,
  getCurrentStep,
  getUnlockedStepIndex,
  isVerifiedOnboardingSession,
  shouldShowOnboardingPanel,
  shouldShowWalletAuthGate,
} from "@/lib/onboarding/flow-selectors";

export function runBootsStoredSession(session: Session) {
  const state = createInitialState(session);
  expect(state.phase).toBe("booting");
  expect(getCurrentStep(state)).toBeNull();
  expect(isVerifiedOnboardingSession(state, true)).toBe(false);
  expect(shouldShowOnboardingPanel(state)).toBe(false);
  expect(shouldShowWalletAuthGate(state)).toBe(false);
  expect(getUnlockedStepIndex(state, false)).toBe(0);
}

export function runUsesCachedCompletionAsReloadGuard(session: Session) {
  const state = createInitialState(session, true);
  expect(state.phase).toBe("ready_completed");
  expect(getCurrentStep(state)).toBeNull();
  expect(isVerifiedOnboardingSession(state, false)).toBe(false);
  expect(shouldShowOnboardingPanel(state)).toBe(false);
}

export function runShowsAuthGateWithoutWallet() {
  const state = createInitialState(null);
  expect(state.phase).toBe("no_wallet");
  expect(getCurrentStep(state)).toBeNull();
  expect(shouldShowWalletAuthGate(state)).toBe(true);
}

export function runDoesNotExposeStepAfterCompletion(session: Session) {
  const loadingState = onboardingReducer(createInitialState(session), { type: "SIGNED_IN", session });
  const completedState = onboardingReducer(loadingState, {
    type: "PROFILE_LOADED",
    payload: {
      profile: { twinId: session.twinId, name: "Sivraj" },
      identity: {
        twinId: session.twinId,
        displayName: "John",
        aliases: ["John Doe"],
        emails: [],
        phones: [],
        handles: {},
        selfDescriptionArtifactId: "artifact_123",
        onboardingStatus: "completed",
        firstMeetIntroStatus: "consumed",
        shouldPlayFirstMeetIntro: false,
        events: [],
      },
      voiceResponse: null,
    },
  });
  expect(completedState.phase).toBe("ready_completed");
  expect(isVerifiedOnboardingSession(completedState, true)).toBe(true);
  expect(canUseProtectedApp(completedState, true)).toBe(true);
  expect(getCurrentStep(completedState)).toBeNull();
  expect(shouldShowOnboardingPanel(completedState)).toBe(false);
}

export function runDoesNotTrustSessionDuringBootstrap(session: Session) {
  const loadingState = onboardingReducer(createInitialState(session), { type: "PROFILE_LOADING" });
  expect(loadingState.phase).toBe("loading_profile");
  expect(isVerifiedOnboardingSession(loadingState, true)).toBe(false);
  expect(canUseProtectedApp(loadingState, true)).toBe(false);
  expect(getUnlockedStepIndex(loadingState, false)).toBe(0);
}

export function runAllowsProtectedAccessDuringBootstrap(session: Session) {
  const loadingState = onboardingReducer(createInitialState(session, true), { type: "PROFILE_LOADING" });
  expect(loadingState.phase).toBe("loading_profile");
  expect(canUseProtectedApp(loadingState, true)).toBe(true);
  expect(shouldShowOnboardingPanel(loadingState)).toBe(false);
}

export function runRoutesVerifiedWalletToOnboarding(session: Session) {
  const loadingState = onboardingReducer(createInitialState(session), { type: "SIGNED_IN", session });
  const onboardingState = onboardingReducer(loadingState, {
    type: "PROFILE_LOADED",
    payload: {
      profile: { twinId: session.twinId, name: "Primary Twin" },
      identity: {
        twinId: session.twinId,
        displayName: null,
        aliases: [],
        emails: [],
        phones: [],
        handles: {},
        selfDescriptionArtifactId: null,
        onboardingStatus: "not_started",
        firstMeetIntroStatus: "not_started",
        shouldPlayFirstMeetIntro: false,
        events: [],
      },
      voiceResponse: null,
    },
  });
  expect(onboardingState.phase).toBe("ready_onboarding");
  expect(isVerifiedOnboardingSession(onboardingState, true)).toBe(true);
  expect(canUseProtectedApp(onboardingState, true)).toBe(false);
  expect(getCurrentStep(onboardingState)).toBe("name");
  expect(shouldShowOnboardingPanel(onboardingState)).toBe(true);
}

export function runAllowsReturningToConnectDuringOnboarding(session: Session) {
  const loadingState = onboardingReducer(createInitialState(session), { type: "SIGNED_IN", session });
  const onboardingState = onboardingReducer(loadingState, {
    type: "PROFILE_LOADED",
    payload: {
      profile: { twinId: session.twinId, name: "Primary Twin" },
      identity: {
        twinId: session.twinId,
        displayName: null,
        aliases: [],
        emails: [],
        phones: [],
        handles: {},
        selfDescriptionArtifactId: null,
        onboardingStatus: "not_started",
        firstMeetIntroStatus: "not_started",
        shouldPlayFirstMeetIntro: false,
        events: [],
      },
      voiceResponse: null,
    },
  });
  const connectState = onboardingReducer(onboardingState, {
    type: "STEP_CHANGED",
    step: "connect",
  });

  expect(getCurrentStep(connectState)).toBe("connect");
  expect(getUnlockedStepIndex(connectState, true)).toBeGreaterThanOrEqual(1);
  expect(shouldShowOnboardingPanel(connectState)).toBe(true);
}

export function runCommitsOnboardingCompletionWithRuntimeEvent(session: Session) {
  const loadingState = onboardingReducer(createInitialState(session), { type: "SIGNED_IN", session });
  const completedState = onboardingReducer(loadingState, {
    type: "IDENTITY_PROFILE_SAVED",
    profile: {
      twinId: session.twinId,
      displayName: "John",
      aliases: ["John Doe"],
      emails: [],
      phones: [],
      handles: {},
      selfDescriptionArtifactId: "artifact_123",
      onboardingStatus: "completed",
      firstMeetIntroStatus: "issued",
      shouldPlayFirstMeetIntro: true,
      events: [
        {
          type: "first_meet_intro.requested",
          eventId: `${session.twinId}:first-meet-intro`,
          dedupeKey: `${session.twinId}:first-meet-intro`,
          text: "Hi John! I'm Jarvis.",
          voiceStyle: "energetic",
        },
      ],
    },
  });
  expect(completedState.phase).toBe("ready_completed");
  expect(completedState.saveStage).toBe("complete");
  expect(completedState.firstMeetIntroStatus).toBe("issued");
  expect(completedState.firstMeetIntroActive).toBe(false);
  expect(completedState.runtimeEvents).toEqual([
    {
      type: "first_meet_intro.requested",
      eventId: `${session.twinId}:first-meet-intro`,
      dedupeKey: `${session.twinId}:first-meet-intro`,
      text: "Hi John! I'm Jarvis.",
      voiceStyle: "energetic",
    },
  ]);
  expect(getCurrentStep(completedState)).toBeNull();
}

export function runCompletesOnboardingWithoutIntroCue(session: Session) {
  const loadingState = onboardingReducer(createInitialState(session), { type: "SIGNED_IN", session });
  const completedState = onboardingReducer(loadingState, {
    type: "IDENTITY_PROFILE_SAVED",
    profile: {
      twinId: session.twinId,
      displayName: "John",
      aliases: ["John Doe"],
      emails: [],
      phones: [],
      handles: {},
      selfDescriptionArtifactId: "artifact_123",
      onboardingStatus: "completed",
      firstMeetIntroStatus: "consumed",
      shouldPlayFirstMeetIntro: false,
      events: [],
    },
  });

  expect(completedState.phase).toBe("ready_completed");
  expect(completedState.greeting).toBe("");
  expect(completedState.greetingAudioUrl).toBeNull();
  expect(completedState.firstMeetIntroStatus).toBe("consumed");
  expect(completedState.firstMeetIntroActive).toBe(false);
  expect(completedState.runtimeEvents).toEqual([]);
}

export function runTracksFirstMemoryArtifact(session: Session) {
  const storedState = onboardingReducer(createInitialState(session), {
    type: "FIRST_MEMORY_STORED",
    artifactId: "artifact_123",
  });
  expect(storedState.firstMemoryArtifactId).toBe("artifact_123");
}

export function runClearsFirstMemoryArtifactOnTextChange(session: Session) {
  const storedState = onboardingReducer(createInitialState(session), {
    type: "FIRST_MEMORY_STORED",
    artifactId: "artifact_123",
  });
  const changedState = onboardingReducer(storedState, {
    type: "SET_FIRST_MEMORY",
    value: "A different first memory",
  });
  expect(changedState.firstMemoryArtifactId).toBeNull();
}

export function runShowsAuthGateForActiveWalletSignature(session: Session) {
  const completedState = onboardingReducer(createInitialState(session, true), {
    type: "WALLET_NEEDS_SIGNATURE",
    hasCompletionHint: true,
  });
  expect(completedState.phase).toBe("needs_wallet_signature");
  expect(completedState.session).toBeNull();
  expect(completedState.hasCompletionHint).toBe(true);
  expect(canUseProtectedApp(completedState, true)).toBe(false);
  expect(getCurrentStep(completedState)).toBeNull();
  expect(shouldShowWalletAuthGate(completedState)).toBe(true);
  expect(shouldShowOnboardingPanel(completedState)).toBe(false);
}

export function runKeepsNewWalletsAuthGated() {
  const state = onboardingReducer(createInitialState(null), {
    type: "WALLET_NEEDS_SIGNATURE",
    hasCompletionHint: false,
  });
  expect(state.phase).toBe("needs_wallet_signature");
  expect(state.hasCompletionHint).toBe(false);
  expect(canUseProtectedApp(state, false)).toBe(false);
  expect(shouldShowWalletAuthGate(state)).toBe(true);
  expect(shouldShowOnboardingPanel(state)).toBe(false);
}

export function runClearsProtectedAccessWithoutWallet(session: Session) {
  const completedState = onboardingReducer(createInitialState(session, true), { type: "NO_WALLET" });
  expect(completedState.phase).toBe("no_wallet");
  expect(completedState.session).toBeNull();
  expect(getCurrentStep(completedState)).toBeNull();
  expect(shouldShowWalletAuthGate(completedState)).toBe(true);
}

export function runIgnoresPanelDuringBootstrap(session: Session) {
  const completedState = createInitialState(session, true);
  const loadingState = onboardingReducer(completedState, { type: "PROFILE_LOADING" });
  expect(loadingState.phase).toBe("loading_profile");
  expect(getCurrentStep(loadingState)).toBeNull();
  expect(shouldShowOnboardingPanel(loadingState)).toBe(false);
}
