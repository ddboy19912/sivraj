import {
  type Dispatch,
  type RefObject,
  useEffect,
  useEffectEvent,
  useReducer,
  useRef,
} from "react";
import { errorMessage, postAuthedJson, putAuthedJson } from "@/lib/api";
import { buildClientEncryptedArtifactBody, prewarmClientEncryption } from "@/lib/encryption";
import { markOnboardingCompleted } from "@/lib/onboarding/completion";
import { parseCommaList } from "@/lib/onboarding/copy";
import {
  createInitialState,
  onboardingReducer,
} from "@/lib/onboarding/flow-reducer";
import {
  getCurrentStep,
  getUnlockedStepIndex,
  hasCompletedOnboardingHint,
  normalizeTwinName,
  twinNameFromState,
} from "@/lib/onboarding/flow-selectors";
import type { Session } from "@/lib/session";
import type {
  ActiveOnboardingStep,
  ArtifactReceipt,
  TwinIdentityProfile,
  TwinProfile,
} from "@/types/onboarding.types";
import type {
  OnboardingAction,
  OnboardingState,
} from "@/types/onboarding.types";
import {
  ONBOARDING_STEP_ORDER,
} from "@/types/onboarding.types";
import type {
  AppAccessState,
  TwinBootstrap,
} from "@/types/wallet.types";
import { useWalletAccess } from "@/hooks/wallet/useWalletAccess";
import { useOnboardingVoiceControls } from "@/hooks/onboarding/useOnboardingVoiceControls";

type OnboardingFlowActionsInput = {
  state: OnboardingState;
  session: Session | null;
  setSession: (session: Session) => void;
  dispatch: Dispatch<OnboardingAction>;
  unlockedStepIndex: number;
  updateBootstrap: (updater: (current: TwinBootstrap) => TwinBootstrap) => void;
};

export function useOnboardingFlow() {
  const walletAccess = useWalletAccess();
  const { state, actions, voiceControls, dispatch } = useOnboardingFlowCore({
    session: walletAccess.session,
    setSession: walletAccess.setSession,
    bootstrap: walletAccess.bootstrap,
    isSessionForWallet: walletAccess.isSessionForWallet,
    updateBootstrap: walletAccess.updateBootstrap,
  });

  return buildOnboardingFlowView({
    state,
    accessState: walletAccess.accessState,
    account: walletAccess.account,
    session: walletAccess.session,
    isSessionForWallet: walletAccess.isSessionForWallet,
    canUseProtectedApp: walletAccess.canUseProtectedApp,
    signIn: walletAccess.signIn,
    resetSession: walletAccess.resetSession,
    formSetters: createOnboardingFormSetters(dispatch),
    voiceControls,
    actions,
    setSession: walletAccess.setSession,
  });
}

function useOnboardingFlowCore({
  session,
  setSession,
  bootstrap,
  isSessionForWallet,
  updateBootstrap,
}: {
  session: Session | null;
  setSession: (session: Session) => void;
  bootstrap: TwinBootstrap | null;
  isSessionForWallet: boolean;
  updateBootstrap: (
    updater: (current: TwinBootstrap) => TwinBootstrap,
  ) => void;
}) {
  const [state, dispatch] = useReducer(onboardingReducer, undefined, () =>
    createInitialState(null),
  );
  const greetingAudioUrlRef = useRef<string | null>(null);
  const appliedBootstrapKeyRef = useRef<string | null>(null);
  const voiceControls = useOnboardingVoiceControls({
    state: {
      isBusy: state.isBusy,
      recorderState: state.recorderState,
      recordedBlob: state.recordedBlob,
      recordingPreviewUrl: state.recordingPreviewUrl,
      cloneConsent: state.cloneConsent,
      session,
    },
    dispatch,
    setSession,
  });

  useOnboardingFlowEffects({
    state,
    session,
    bootstrap,
    greetingAudioUrlRef,
    appliedBootstrapKeyRef,
    dispatch,
    revokePreviewAudio: voiceControls.revokePreviewAudio,
    stopRecordingStream: voiceControls.stopRecordingStream,
    stopRecordingTimer: voiceControls.stopRecordingTimer,
  });

  const actions = useOnboardingFlowActions({
    state,
    session,
    setSession,
    dispatch,
    unlockedStepIndex: getUnlockedStepIndex(state, isSessionForWallet),
    updateBootstrap,
  });

  return {
    actions,
    dispatch,
    state,
    voiceControls,
  };
}

function buildOnboardingFlowView(input: {
  state: OnboardingState;
  accessState: AppAccessState;
  session: Session | null;
  isSessionForWallet: boolean;
  canUseProtectedApp: boolean;
  signIn: () => void;
  resetSession: () => void;
  account: { address: string } | null | undefined;
  formSetters: ReturnType<typeof createOnboardingFormSetters>;
  voiceControls: {
    previewPresetVoice: (voiceId: string) => Promise<void>;
    chooseClonedVoiceArrival: () => Promise<void>;
    startVoiceCloneRecording: () => Promise<void>;
    stopVoiceCloneRecording: () => void;
    clearVoiceCloneRecording: () => void;
  };
  actions: ReturnType<typeof useOnboardingFlowActions>;
  setSession: (session: Session) => void;
}) {
  return {
    ...buildOnboardingStateFields(input),
    setSession: input.setSession,
    signIn: input.signIn,
    resetSession: input.resetSession,
    beginOnboarding: input.actions.beginOnboarding,
    goToStep: input.actions.goToStep,
    saveTwinName: input.actions.saveTwinName,
    chooseTextArrival: input.actions.chooseTextArrival,
    chooseVoiceArrival: input.actions.chooseVoiceArrival,
    previewPresetVoice: input.voiceControls.previewPresetVoice,
    chooseClonedVoiceArrival: input.voiceControls.chooseClonedVoiceArrival,
    startVoiceCloneRecording: input.voiceControls.startVoiceCloneRecording,
    stopVoiceCloneRecording: input.voiceControls.stopVoiceCloneRecording,
    clearVoiceCloneRecording: input.voiceControls.clearVoiceCloneRecording,
    saveIdentitySeed: input.actions.saveIdentitySeed,
    ...input.formSetters,
  };
}

function buildOnboardingStateFields(input: {
  state: OnboardingState;
  accessState: AppAccessState;
  account: { address: string } | null | undefined;
  session: Session | null;
  isSessionForWallet: boolean;
  canUseProtectedApp: boolean;
}) {
  const currentStep = resolveOnboardingCurrentStep(input.state, input.accessState);
  const twinName = twinNameFromState(input.state) || input.state.form.twinNameInput;

  return {
    accessState: input.accessState,
    account: input.account,
    session: input.session,
    phase: input.state.phase,
    currentStep,
    twinName,
    twinNameInput: input.state.form.twinNameInput,
    displayName: input.state.form.displayName,
    alias: input.state.form.alias,
    firstMemory: input.state.form.firstMemory,
    greeting: input.state.greeting,
    greetingAudioUrl: input.state.greetingAudioUrl,
    greetingAudioFailed: input.state.greetingAudioFailed,
    firstMeetIntroStatus: input.state.firstMeetIntroStatus,
    firstMeetIntroActive: input.state.firstMeetIntroActive,
    runtimeEvents: input.state.runtimeEvents,
    voicePresets: input.state.voicePresets,
    selectedVoiceId: input.state.selectedVoiceId,
    previewingVoiceId: input.state.previewingVoiceId,
    recorderState: input.state.recorderState,
    recordingSeconds: input.state.recordingSeconds,
    recordedBlob: input.state.recordedBlob,
    recordingPreviewUrl: input.state.recordingPreviewUrl,
    cloneConsent: input.state.cloneConsent,
    isBusy: input.state.isBusy,
    saveStage: input.state.saveStage,
    error: input.state.error,
    isSessionForWallet: input.isSessionForWallet,
    canUseProtectedApp: input.canUseProtectedApp,
    completedOnboardingHint: hasCompletedOnboardingHint(input.state),
    onboardingComplete: input.accessState.status === "app_ready",
    unlockedStepIndex: getUnlockedStepIndex(input.state, input.isSessionForWallet),
  };
}

function createOnboardingFormSetters(dispatch: Dispatch<OnboardingAction>) {
  return {
    setTwinNameInput: (value: string) => dispatch({ type: "SET_TWIN_NAME", value }),
    setSelectedVoiceId: (voiceId: string) =>
      dispatch({ type: "SET_SELECTED_VOICE", voiceId }),
    setCloneConsent: (value: boolean) => dispatch({ type: "SET_CLONE_CONSENT", value }),
    setDisplayName: (value: string) => dispatch({ type: "SET_DISPLAY_NAME", value }),
    setAlias: (value: string) => dispatch({ type: "SET_ALIAS", value }),
    setFirstMemory: (value: string) => dispatch({ type: "SET_FIRST_MEMORY", value }),
  };
}

function resolveOnboardingCurrentStep(
  state: OnboardingState,
  accessState: AppAccessState,
) {
  return (
    getCurrentStep(state) ??
    (accessState.status === "onboarding"
      ? normalizeTwinName(accessState.bootstrap.profile.name)
        ? "arrival"
        : "name"
      : null)
  );
}

function useOnboardingFlowActions(input: OnboardingFlowActionsInput) {
  return {
    beginOnboarding: () => input.dispatch({ type: "BEGIN" }),
    chooseTextArrival: () => input.dispatch({ type: "STEP_CHANGED", step: "identity" }),
    chooseVoiceArrival: () => chooseVoiceArrival(input),
    goToStep: (stepId: ActiveOnboardingStep) => goToStep(input, stepId),
    saveIdentitySeed: () => saveIdentitySeed(input),
    saveTwinName: () => saveTwinName(input),
  };
}

async function saveTwinName({
  state,
  session,
  setSession,
  dispatch,
  updateBootstrap,
}: OnboardingFlowActionsInput) {
  if (!session || state.isBusy) {
    return;
  }

  const name = state.form.twinNameInput.trim();
  if (!name) {
    dispatch({
      type: "ERROR",
      message: "Give your Twin a name before it can meet you.",
    });
    return;
  }

  dispatch({ type: "BUSY", value: true });
  dispatch({ type: "ERROR", message: null });

  try {
    const profile = await putAuthedJson<TwinProfile>(
      `/v1/twins/${session.twinId}/profile`,
      { name },
      session,
      setSession,
    );

    dispatch({ type: "TWIN_PROFILE_SAVED", profile });
    updateBootstrap((current) => ({ ...current, profile }));
    dispatch({ type: "BUSY", value: false });
  } catch (saveError) {
    dispatch({ type: "ERROR", message: errorMessage(saveError) });
    dispatch({ type: "BUSY", value: false });
  }
}

async function chooseVoiceArrival({
  state,
  session,
  setSession,
  dispatch,
}: OnboardingFlowActionsInput) {
  if (!session || state.isBusy) {
    return;
  }

  dispatch({ type: "BUSY", value: true });
  dispatch({ type: "ERROR", message: null });

  try {
    await postAuthedJson(
      `/v1/twins/${session.twinId}/voice/profile`,
      {
        mode: "preset",
        presetVoiceId: state.selectedVoiceId || state.defaultVoiceId,
      },
      session,
      setSession,
    );
    dispatch({ type: "STEP_CHANGED", step: "identity" });
    dispatch({ type: "BUSY", value: false });
  } catch (voiceError) {
    dispatch({ type: "ERROR", message: errorMessage(voiceError) });
    dispatch({ type: "BUSY", value: false });
  }
}

function goToStep(input: OnboardingFlowActionsInput, nextStep: ActiveOnboardingStep) {
  const nextIndex = ONBOARDING_STEP_ORDER.indexOf(nextStep);
  if (nextIndex < 0 || nextIndex > input.unlockedStepIndex) {
    return;
  }

  input.dispatch({ type: "STEP_CHANGED", step: nextStep });
}

async function saveIdentitySeed(input: OnboardingFlowActionsInput) {
  if (!input.session || input.state.isBusy) {
    return;
  }

  await runOnboardingIdentitySave({
    state: input.state,
    session: input.session,
    setSession: input.setSession,
    dispatch: input.dispatch,
    updateBootstrap: input.updateBootstrap,
  });
}

async function runOnboardingIdentitySave({
  state,
  session,
  setSession,
  dispatch,
  updateBootstrap,
}: {
  state: OnboardingState;
  session: Session;
  setSession: (session: Session) => void;
  dispatch: Dispatch<OnboardingAction>;
  updateBootstrap: (updater: (current: TwinBootstrap) => TwinBootstrap) => void;
}) {
  const trimmedMemory = state.form.firstMemory.trim();
  if (!trimmedMemory) {
    dispatch({
      type: "ERROR",
      message: "Tell your Twin one thing to remember first.",
    });
    return;
  }

  dispatch({ type: "BUSY", value: true });
  dispatch({ type: "SAVE_STAGE", stage: "encrypting" });
  dispatch({ type: "ERROR", message: null });

  try {
    const firstMemoryArtifactId = await ensureFirstMemoryArtifact({
      state,
      session,
      setSession,
      dispatch,
      trimmedMemory,
    });

    dispatch({ type: "SAVE_STAGE", stage: "finishing_profile" });
    const completedProfile = await finishIdentityProfile({
      state,
      session,
      setSession,
      firstMemoryArtifactId,
    });

    markOnboardingCompleted(session);
    updateBootstrap((current) => ({
      ...current,
      identity: completedProfile,
    }));

    dispatch({ type: "IDENTITY_PROFILE_SAVED", profile: completedProfile });
  } catch (identityError) {
    dispatch({ type: "ERROR", message: errorMessage(identityError) });
    dispatch({ type: "SAVE_STAGE", stage: "idle" });
  } finally {
    dispatch({ type: "BUSY", value: false });
  }
}

async function ensureFirstMemoryArtifact({
  state,
  session,
  setSession,
  dispatch,
  trimmedMemory,
}: {
  state: OnboardingState;
  session: Session;
  setSession: (session: Session) => void;
  dispatch: Dispatch<OnboardingAction>;
  trimmedMemory: string;
}): Promise<string> {
  if (state.firstMemoryArtifactId) {
    return state.firstMemoryArtifactId;
  }

  const encryptedBody = await buildClientEncryptedArtifactBody({
    sourceType: "onboarding_self_description",
    title: "Twin first memory",
    content: trimmedMemory,
    metadata: { onboarding: { kind: "first_memory" } },
  });
  dispatch({ type: "SAVE_STAGE", stage: "storing_memory" });
  const artifact = await postAuthedJson<ArtifactReceipt>(
    `/v1/twins/${session.twinId}/artifacts`,
    encryptedBody,
    session,
    setSession,
  );
  dispatch({
    type: "FIRST_MEMORY_STORED",
    artifactId: artifact.artifactId,
  });

  return artifact.artifactId;
}

async function finishIdentityProfile({
  state,
  session,
  setSession,
  firstMemoryArtifactId,
}: {
  state: OnboardingState;
  session: Session;
  setSession: (session: Session) => void;
  firstMemoryArtifactId: string;
}) {
  return putAuthedJson<TwinIdentityProfile>(
    `/v1/twins/${session.twinId}/identity-profile`,
    {
      displayName: state.form.displayName.trim() || null,
      aliases: parseCommaList(state.form.alias),
      emails: [],
      phones: [],
      handles: {},
      selfDescriptionArtifactId: firstMemoryArtifactId,
      onboardingStatus: "completed",
    },
    session,
    setSession,
  );
}

function useOnboardingFlowEffects({
  state,
  session,
  bootstrap,
  greetingAudioUrlRef,
  appliedBootstrapKeyRef,
  dispatch,
  revokePreviewAudio,
  stopRecordingStream,
  stopRecordingTimer,
}: {
  state: OnboardingState;
  session: Session | null;
  bootstrap: TwinBootstrap | null;
  greetingAudioUrlRef: RefObject<string | null>;
  appliedBootstrapKeyRef: RefObject<string | null>;
  dispatch: Dispatch<OnboardingAction>;
  revokePreviewAudio: () => void;
  stopRecordingStream: () => void;
  stopRecordingTimer: () => void;
}) {
  useSessionSyncEffect({ session, appliedBootstrapKeyRef, dispatch });
  useBootstrapEffect({ session, bootstrap, appliedBootstrapKeyRef, dispatch });
  useCleanupEffects({
    greetingAudioUrl: state.greetingAudioUrl,
    greetingAudioUrlRef,
    recordingPreviewUrl: state.recordingPreviewUrl,
    revokePreviewAudio,
    stopRecordingStream,
    stopRecordingTimer,
  });
  useEncryptionPrewarmEffect({
    activeStep: state.activeStep,
    session,
  });
}

function useSessionSyncEffect({
  session,
  appliedBootstrapKeyRef,
  dispatch,
}: {
  session: Session | null;
  appliedBootstrapKeyRef: RefObject<string | null>;
  dispatch: Dispatch<OnboardingAction>;
}) {
  useEffect(() => {
    if (!session) {
      appliedBootstrapKeyRef.current = null;
      return;
    }

    dispatch({ type: "SESSION_REFRESHED", session });
  }, [appliedBootstrapKeyRef, dispatch, session]);
}

function useBootstrapEffect({
  session,
  bootstrap,
  appliedBootstrapKeyRef,
  dispatch,
}: {
  session: Session | null;
  bootstrap: TwinBootstrap | null;
  appliedBootstrapKeyRef: RefObject<string | null>;
  dispatch: Dispatch<OnboardingAction>;
}) {
  useEffect(() => {
    if (!bootstrap || !session) {
      return;
    }

    const bootstrapKey = [
      session.walletAddress,
      session.twinId,
      bootstrap.identity.onboardingStatus,
      bootstrap.identity.firstMeetIntroStatus,
      bootstrap.identity.events.map((event) => event.eventId).join(","),
      bootstrap.profile.name,
    ].join(":");
    if (appliedBootstrapKeyRef.current === bootstrapKey) {
      return;
    }

    appliedBootstrapKeyRef.current = bootstrapKey;
    dispatch({
      type: "PROFILE_LOADED",
      payload: bootstrap,
    });
  }, [appliedBootstrapKeyRef, bootstrap, dispatch, session]);
}

function useCleanupEffects({
  greetingAudioUrl,
  greetingAudioUrlRef,
  recordingPreviewUrl,
  revokePreviewAudio,
  stopRecordingStream,
  stopRecordingTimer,
}: {
  greetingAudioUrl: string | null;
  greetingAudioUrlRef: RefObject<string | null>;
  recordingPreviewUrl: string | null;
  revokePreviewAudio: () => void;
  stopRecordingStream: () => void;
  stopRecordingTimer: () => void;
}) {
  const cleanupRef = useRef({
    greetingAudioUrl,
    recordingPreviewUrl,
    revokePreviewAudio,
    stopRecordingStream,
    stopRecordingTimer,
  });

  useEffect(() => {
    greetingAudioUrlRef.current = greetingAudioUrl;
    cleanupRef.current = {
      greetingAudioUrl,
      recordingPreviewUrl,
      revokePreviewAudio,
      stopRecordingStream,
      stopRecordingTimer,
    };
  }, [
    greetingAudioUrl,
    greetingAudioUrlRef,
    recordingPreviewUrl,
    revokePreviewAudio,
    stopRecordingStream,
    stopRecordingTimer,
  ]);

  const cleanupLatestResources = useEffectEvent(() => {
    const cleanup = cleanupRef.current;

    if (cleanup.greetingAudioUrl) {
      URL.revokeObjectURL(cleanup.greetingAudioUrl);
    }
    cleanup.revokePreviewAudio();
    cleanup.stopRecordingTimer();
    cleanup.stopRecordingStream();
    if (cleanup.recordingPreviewUrl) {
      URL.revokeObjectURL(cleanup.recordingPreviewUrl);
    }
  });

  useEffect(() => {
    return () => cleanupLatestResources();
  }, []);
}

function useEncryptionPrewarmEffect({
  activeStep,
  session,
}: {
  activeStep: string | null;
  session: Session | null;
}) {
  useEffect(() => {
    if (activeStep !== "identity" || !session) {
      return;
    }

    void prewarmClientEncryption().catch(() => {
      // The submit path reports encryption configuration or network failures.
    });
  }, [activeStep, session]);
}
