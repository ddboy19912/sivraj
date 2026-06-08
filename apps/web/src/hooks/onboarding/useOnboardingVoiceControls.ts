import { type Dispatch, useRef } from "react";
import { errorMessage, getAuthedAudio, postAuthedJson } from "@/lib/api";
import type {
  OnboardingAction,
  RecorderState,
} from "@/types/onboarding.types";
import type { Session } from "@/lib/session";

type VoiceControlState = {
  isBusy: boolean;
  recorderState: RecorderState;
  recordedBlob: Blob | null;
  recordingPreviewUrl: string | null;
  cloneConsent: boolean;
  session: Session | null;
};

type VoiceControlInput = {
  state: VoiceControlState;
  dispatch: Dispatch<OnboardingAction>;
  setSession: (session: Session) => void;
};

type MutableRef<T> = { current: T };

export function useOnboardingVoiceControls({
  state,
  dispatch,
  setSession,
}: VoiceControlInput) {
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const previewAudioUrlRef = useRef<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordingStartedAtRef = useRef<number | null>(null);
  const recordingTimerRef = useRef<number | null>(null);

  function revokePreviewAudio() {
    previewAudioRef.current?.pause();
    previewAudioRef.current = null;
    if (previewAudioUrlRef.current) {
      URL.revokeObjectURL(previewAudioUrlRef.current);
      previewAudioUrlRef.current = null;
    }
  }

  async function previewPresetVoice(voiceId: string) {
    if (!state.session || state.isBusy) {
      return;
    }

    await previewPresetVoiceAudio({
      voiceId,
      session: state.session,
      setSession,
      dispatch,
      revokePreviewAudio,
      previewAudioRef,
      previewAudioUrlRef,
    });
  }

  function stopRecordingTimer() {
    if (recordingTimerRef.current !== null) {
      window.clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
  }

  function stopRecordingStream() {
    recorderRef.current?.stream.getTracks().forEach((track) => track.stop());
  }

  function clearVoiceCloneRecording() {
    stopRecordingTimer();
    stopRecordingStream();
    chunksRef.current = [];
    if (state.recordingPreviewUrl) {
      URL.revokeObjectURL(state.recordingPreviewUrl);
    }
    dispatch({ type: "RECORDING_CLEARED" });
  }

  async function startVoiceCloneRecording() {
    await startVoiceCloneRecordingSession({
      isBusy: state.isBusy,
      recorderState: state.recorderState,
      clearVoiceCloneRecording,
      dispatch,
      recorderRef,
      chunksRef,
      recordingStartedAtRef,
      recordingTimerRef,
      stopRecordingTimer,
      stopRecordingStream,
    });
  }

  function stopVoiceCloneRecording() {
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
    }
  }

  async function chooseClonedVoiceArrival() {
    if (!state.session || state.isBusy) {
      return;
    }

    await submitClonedVoiceArrival({
      session: state.session,
      isBusy: state.isBusy,
      recordedBlob: state.recordedBlob,
      cloneConsent: state.cloneConsent,
      setSession,
      dispatch,
      clearVoiceCloneRecording,
    });
  }

  return {
    chooseClonedVoiceArrival,
    clearVoiceCloneRecording,
    previewPresetVoice,
    revokePreviewAudio,
    startVoiceCloneRecording,
    stopRecordingStream,
    stopRecordingTimer,
    stopVoiceCloneRecording,
  };
}

async function previewPresetVoiceAudio({
  voiceId,
  session,
  setSession,
  dispatch,
  revokePreviewAudio,
  previewAudioRef,
  previewAudioUrlRef,
}: {
  voiceId: string;
  session: Session;
  setSession: (session: Session) => void;
  dispatch: Dispatch<OnboardingAction>;
  revokePreviewAudio: () => void;
  previewAudioRef: MutableRef<HTMLAudioElement | null>;
  previewAudioUrlRef: MutableRef<string | null>;
}) {
  revokePreviewAudio();
  dispatch({ type: "VOICE_PREVIEW_STARTED", voiceId });

  try {
    const audio = await getAuthedAudio(
      `/v1/twins/${session.twinId}/voice/presets/${voiceId}/preview`,
      session,
      setSession,
    );
    const url = URL.createObjectURL(audio);
    const player = new Audio(url);
    previewAudioUrlRef.current = url;
    previewAudioRef.current = player;
    player.addEventListener(
      "ended",
      () => dispatch({ type: "VOICE_PREVIEW_ENDED" }),
      { once: true },
    );
    await player.play();
  } catch (previewError) {
    revokePreviewAudio();
    dispatch({ type: "VOICE_PREVIEW_ENDED" });
    dispatch({ type: "ERROR", message: errorMessage(previewError) });
  }
}

async function startVoiceCloneRecordingSession(input: {
  isBusy: boolean;
  recorderState: RecorderState;
  clearVoiceCloneRecording: () => void;
  dispatch: Dispatch<OnboardingAction>;
  recorderRef: MutableRef<MediaRecorder | null>;
  chunksRef: MutableRef<Blob[]>;
  recordingStartedAtRef: MutableRef<number | null>;
  recordingTimerRef: MutableRef<number | null>;
  stopRecordingTimer: () => void;
  stopRecordingStream: () => void;
}) {
  if (!isVoiceRecordingSupported()) {
    input.dispatch({
      type: "ERROR",
      message: "This browser does not support voice recording.",
    });
    return;
  }

  if (
    input.isBusy ||
    input.recorderState === "requesting" ||
    input.recorderState === "saving"
  ) {
    return;
  }

  input.clearVoiceCloneRecording();
  input.dispatch({ type: "ERROR", message: null });
  input.dispatch({ type: "RECORDER_STATE", value: "requesting" });

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    setupVoiceCloneRecorder(stream, input);
  } catch (recordingError) {
    input.stopRecordingTimer();
    input.stopRecordingStream();
    input.dispatch({ type: "RECORDER_STATE", value: "idle" });
    input.dispatch({ type: "ERROR", message: errorMessage(recordingError) });
  }
}

async function submitClonedVoiceArrival({
  session,
  isBusy,
  recordedBlob,
  cloneConsent,
  setSession,
  dispatch,
  clearVoiceCloneRecording,
}: {
  session: Session;
  isBusy: boolean;
  recordedBlob: Blob | null;
  cloneConsent: boolean;
  setSession: (session: Session) => void;
  dispatch: Dispatch<OnboardingAction>;
  clearVoiceCloneRecording: () => void;
}) {
  if (isBusy) {
    return;
  }

  if (!recordedBlob) {
    dispatch({
      type: "ERROR",
      message: "Record a voice sample before creating a clone.",
    });
    return;
  }

  if (!cloneConsent) {
    dispatch({
      type: "ERROR",
      message: "Confirm consent before creating a cloned voice.",
    });
    return;
  }

  dispatch({ type: "BUSY", value: true });
  dispatch({ type: "RECORDER_STATE", value: "saving" });
  dispatch({ type: "ERROR", message: null });

  try {
    const audioBase64 = await blobToBase64(recordedBlob);
    await postAuthedJson(
      `/v1/twins/${session.twinId}/voice/profile`,
      {
        mode: "clone",
        consent: true,
        audioBase64,
        mimeType: recordedBlob.type || "audio/webm",
        fileName: `voice-profile-${new Date().toISOString().replace(/[:.]/g, "-")}.webm`,
      },
      session,
      setSession,
    );
    clearVoiceCloneRecording();
    dispatch({ type: "SET_CLONE_CONSENT", value: false });
    dispatch({ type: "STEP_CHANGED", step: "identity" });
  } catch (cloneError) {
    dispatch({ type: "RECORDER_STATE", value: "recorded" });
    dispatch({ type: "ERROR", message: errorMessage(cloneError) });
  } finally {
    dispatch({ type: "BUSY", value: false });
  }
}

function setupVoiceCloneRecorder(
  stream: MediaStream,
  input: {
    dispatch: Dispatch<OnboardingAction>;
    recorderRef: MutableRef<MediaRecorder | null>;
    chunksRef: MutableRef<Blob[]>;
    recordingStartedAtRef: MutableRef<number | null>;
    recordingTimerRef: MutableRef<number | null>;
    stopRecordingTimer: () => void;
    stopRecordingStream: () => void;
  },
) {
  const recorder = new MediaRecorder(stream);
  input.recorderRef.current = recorder;
  input.chunksRef.current = [];
  input.recordingStartedAtRef.current = Date.now();

  recorder.addEventListener("dataavailable", (event) => {
    if (event.data.size > 0) {
      input.chunksRef.current.push(event.data);
    }
  });
  recorder.addEventListener(
    "stop",
    createRecordingStopHandler({
      chunks: input.chunksRef.current,
      recorder,
      stopRecordingTimer: input.stopRecordingTimer,
      stopRecordingStream: input.stopRecordingStream,
      onReady: (blob, previewUrl) => {
        input.dispatch({ type: "RECORDING_READY", blob, previewUrl });
      },
    }),
  );

  recorder.start();
  input.dispatch({ type: "RECORDER_STATE", value: "recording" });
  input.recordingTimerRef.current = window.setInterval(() => {
    const startedAt = input.recordingStartedAtRef.current;
    input.dispatch({
      type: "RECORDING_TICK",
      seconds: startedAt ? Math.floor((Date.now() - startedAt) / 1000) : 0,
    });
  }, 250);
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      resolve(result.split(",")[1] ?? "");
    });
    reader.addEventListener("error", () =>
      reject(reader.error ?? new Error("Failed to read audio.")),
    );
    reader.readAsDataURL(blob);
  });
}

function isVoiceRecordingSupported() {
  return Boolean(
    Boolean(navigator.mediaDevices?.getUserMedia) &&
      typeof globalThis.MediaRecorder === "function",
  );
}

function createRecordingStopHandler({
  chunks,
  recorder,
  stopRecordingTimer,
  stopRecordingStream,
  onReady,
}: {
  chunks: Blob[];
  recorder: MediaRecorder;
  stopRecordingTimer: () => void;
  stopRecordingStream: () => void;
  onReady: (blob: Blob, previewUrl: string) => void;
}) {
  return () => {
    const blob = new Blob(chunks, {
      type: recorder.mimeType || "audio/webm",
    });
    const previewUrl = URL.createObjectURL(blob);
    stopRecordingTimer();
    stopRecordingStream();
    onReady(blob, previewUrl);
  };
}
