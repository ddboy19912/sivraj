import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  type Dispatch,
  type RefObject,
} from "react";
import { errorMessage } from "@/lib/api";
import {
  createInitialHomepageVoiceState,
  homepageVoiceReducer,
} from "@/lib/voice/voice-chat-reducer";
import {
  createRealtimeVoiceSynthesisSession,
  createRealtimeVoiceTranscriptionSession,
  loadVoiceProfile,
  loadVoiceSettings,
  transcribeVoiceAudio,
  updateVoiceSettings,
} from "@/lib/voice/voice-api";
import {
  createCartesiaRealtimeSpeechToTextClient,
  type RealtimeSpeechToTextClient,
} from "@/lib/voice/realtime-stt";
import { createRealtimePcmAudioPlayer } from "@/lib/voice/realtime-audio-player";
import { createCartesiaRealtimeTextToSpeechClient } from "@/lib/voice/realtime-tts";
import {
  createThread,
  streamChatTurn,
  type ChatSurface,
} from "@/lib/chat/chat-api";
import type { Session } from "@/lib/session";
import type { TwinRuntimeEvent } from "@/types/twin.types";

type HomepageVoiceChatInput = {
  session: Session | null;
  enabled: boolean;
  twinName: string;
  onSessionRefreshed: (session: Session) => void;
  onRuntimeEvent: (event: TwinRuntimeEvent) => void;
};

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

type SpeechRecognitionEventLike = {
  results: ArrayLike<ArrayLike<{ transcript: string }>>;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

const WAKE_RECORDING_MS = 6_000;
const PUSH_TO_TALK_KEY_CODE = "Space";
const VOICE_CHAT_SURFACE: ChatSurface = "voice_chat";
export function useHomepageVoiceChat({
  session,
  enabled,
  twinName,
  onSessionRefreshed,
  onRuntimeEvent,
}: HomepageVoiceChatInput) {
  const [state, dispatch] = useReducer(
    homepageVoiceReducer,
    undefined,
    createInitialHomepageVoiceState,
  );
  const stateRef = useRef(state);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const realtimeFallbackRecorderRef = useRef<MediaRecorder | null>(null);
  const realtimeFallbackChunksRef = useRef<Blob[]>([]);
  const realtimeFallbackStopRef = useRef<Promise<Blob | null> | null>(null);
  const realtimeTranscriberRef = useRef<RealtimeSpeechToTextClient | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const activeStreamAbortRef = useRef<AbortController | null>(null);
  const autoStopTimerRef = useRef<number | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const pendingKeyboardStopRef = useRef(false);
  const lastLoggedPhaseRef = useRef(state.phase);
  const sessionRef = useRef(session);
  const onSessionRefreshedRef = useRef(onSessionRefreshed);

  useEffect(() => {
    sessionRef.current = session;
    onSessionRefreshedRef.current = onSessionRefreshed;
  }, [onSessionRefreshed, session]);

  useEffect(() => {
    stateRef.current = state;
    if (lastLoggedPhaseRef.current !== state.phase) {
      voiceDebug("phase", {
        from: lastLoggedPhaseRef.current,
        to: state.phase,
        activeEventId: state.activeEventId,
        error: state.error,
      });
      lastLoggedPhaseRef.current = state.phase;
    }
  }, [state]);

  useEffect(() => {
    dispatch({ type: "WAKE_SUPPORT_RESOLVED", supported: isWakePhraseSupported() });
  }, []);

  useEffect(() => {
    const activeSession = sessionRef.current;
    if (!enabled || !activeSession) {
      return;
    }

    let cancelled = false;
    dispatch({ type: "SETTINGS_LOADING" });

    void Promise.all([
      loadVoiceSettings(activeSession, onSessionRefreshedRef.current),
      loadVoiceProfile(activeSession, onSessionRefreshedRef.current).catch(() => null),
    ])
      .then(([settings, profile]) => {
        if (!cancelled) {
          dispatch({ type: "SETTINGS_READY", settings, profile });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          dispatch({ type: "SETTINGS_FAILED", error: errorMessage(error) });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, session?.twinId]);

  const completeListening = useCallback((eventId: string) => {
    onRuntimeEvent({ type: "agent.listening_completed", eventId });
  }, [onRuntimeEvent]);

  const handleRealtimeTranscript = useCallback(async (eventId: string, text: string) => {
    if (!session) {
      return;
    }

    const transcript = text.trim();
    if (!transcript) {
      dispatch({ type: "FAILED", eventId, error: "No voice input was captured." });
      return;
    }

    dispatch({ type: "TRANSCRIPT_READY", eventId, text: transcript });
    dispatch({ type: "THINKING", eventId });
    try {
      await streamVoiceTurn({
        eventId,
        content: transcript,
        session,
        activeThreadId: stateRef.current.activeThreadId,
        onSessionRefreshed,
        onRuntimeEvent,
        dispatch,
        activeStreamAbortRef,
      });
    } catch (error) {
      if (isAbortError(error)) {
        return;
      }
      onRuntimeEvent({ type: "runtime.cancelled", eventId });
      dispatch({ type: "FAILED", eventId, error: errorMessage(error) });
    }
  }, [onRuntimeEvent, onSessionRefreshed, session]);

  const processRecording = useCallback(async (eventId: string, blob: Blob) => {
    if (!session) {
      return;
    }

    dispatch({ type: "TRANSCRIBING", eventId });
    onRuntimeEvent({
      type: "agent.thinking_started",
      eventId,
      label: "Transcribing",
    });
    completeListening(eventId);

    try {
      const audioBase64 = await blobToBase64(blob);
      const transcript = await transcribeVoiceAudio(
        {
          audioBase64,
          mimeType: blob.type || "audio/webm",
          fileName: `voice-chat-${new Date().toISOString().replace(/[:.]/g, "-")}.webm`,
          prompt: twinName ? `The assistant is named ${twinName}.` : null,
        },
        session,
        onSessionRefreshed,
      );
      dispatch({ type: "TRANSCRIPT_READY", eventId, text: transcript.text });
      dispatch({ type: "THINKING", eventId });
      await streamVoiceTurn({
        eventId,
        content: transcript.text,
        session,
        activeThreadId: stateRef.current.activeThreadId,
        onSessionRefreshed,
        onRuntimeEvent,
        dispatch,
        activeStreamAbortRef,
      });
    } catch (error) {
      if (isAbortError(error)) {
        return;
      }
      onRuntimeEvent({ type: "runtime.cancelled", eventId });
      dispatch({ type: "FAILED", eventId, error: errorMessage(error) });
    }
  }, [
    completeListening,
    onRuntimeEvent,
    onSessionRefreshed,
    session,
    twinName,
  ]);

  const stopRecording = useCallback(() => {
    if (autoStopTimerRef.current !== null) {
      window.clearTimeout(autoStopTimerRef.current);
      autoStopTimerRef.current = null;
    }

    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
    }

    const realtimeTranscriber = realtimeTranscriberRef.current;
    if (realtimeTranscriber) {
      const eventId = stateRef.current.activeEventId;
      realtimeTranscriberRef.current = null;
      if (eventId) {
        const fallbackAudio = stopRealtimeFallbackCapture({
          recorderRef: realtimeFallbackRecorderRef,
          chunksRef: realtimeFallbackChunksRef,
          stopPromiseRef: realtimeFallbackStopRef,
        });
        dispatch({ type: "TRANSCRIBING", eventId });
        onRuntimeEvent({
          type: "agent.thinking_started",
          eventId,
          label: "Transcribing",
        });
        completeListening(eventId);
        void realtimeTranscriber.stop()
          .then(async (transcript) => {
            if (transcript.text.trim()) {
              await handleRealtimeTranscript(eventId, transcript.text);
              return;
            }

            const blob = await fallbackAudio;
            if (blob && blob.size > 0) {
              voiceDebug("realtime transcript empty; falling back to batch STT", {
                eventId,
                bytes: blob.size,
                type: blob.type,
              });
              await processRecording(eventId, blob);
              return;
            }

            await handleRealtimeTranscript(eventId, transcript.text);
          })
          .catch(async (error: unknown) => {
            if (isAbortError(error)) {
              return;
            }

            const blob = await fallbackAudio;
            if (blob && blob.size > 0) {
              voiceDebug("realtime transcription failed; falling back to batch STT", {
                eventId,
                error: describeVoiceError(error),
                bytes: blob.size,
                type: blob.type,
              });
              await processRecording(eventId, blob);
              return;
            }

            onRuntimeEvent({ type: "runtime.cancelled", eventId });
            dispatch({ type: "FAILED", eventId, error: errorMessage(error) });
          });
      } else {
        cancelRealtimeFallbackCapture({
          recorderRef: realtimeFallbackRecorderRef,
          chunksRef: realtimeFallbackChunksRef,
          stopPromiseRef: realtimeFallbackStopRef,
        });
        realtimeTranscriber.cancel();
      }
    }
  }, [completeListening, handleRealtimeTranscript, onRuntimeEvent, processRecording]);

  const startRealtimeRecordingSession = useCallback(async (
    eventId: string,
    stream: MediaStream,
  ): Promise<boolean> => {
    if (!session || !isRealtimeVoiceRecordingSupported()) {
      return false;
    }

    try {
      const realtimeSession = await createRealtimeVoiceTranscriptionSession(
        session,
        onSessionRefreshed,
      );
      const realtimeTranscriber = await createCartesiaRealtimeSpeechToTextClient({
        session: realtimeSession,
        stream,
        onTranscriptUpdate(transcript) {
          dispatch({ type: "USER_TRANSCRIPT_UPDATED", eventId, text: transcript });
        },
      });

      realtimeTranscriberRef.current = realtimeTranscriber;
      return true;
    } catch (error) {
      voiceDebug("realtime transcription unavailable", {
        eventId,
        error: describeVoiceError(error),
      });
      realtimeTranscriberRef.current?.cancel();
      realtimeTranscriberRef.current = null;
      return false;
    }
  }, [onSessionRefreshed, session]);

  const startRecordingSession = useCallback(async (
    eventId: string,
    options: { autoStopMs?: number } = {},
  ) => {
    if (!session) {
      voiceDebug("recording skipped: no session", { eventId });
      return;
    }

    if (!isVoiceRecordingSupported()) {
      voiceDebug("recording unsupported", {
        hasMediaDevices: Boolean(navigator.mediaDevices),
        hasGetUserMedia: Boolean(navigator.mediaDevices?.getUserMedia),
        hasMediaRecorder: typeof globalThis.MediaRecorder === "function",
      });
      dispatch({
        type: "UNSUPPORTED",
        error: "This browser does not support voice recording.",
      });
      return;
    }

    voiceDebug("permission requested", { eventId, autoStopMs: options.autoStopMs ?? null });
    dispatch({ type: "PERMISSION_REQUESTED", eventId });

    function scheduleRecordingStop() {
      if (options.autoStopMs) {
        autoStopTimerRef.current = window.setTimeout(stopRecording, options.autoStopMs);
      } else if (pendingKeyboardStopRef.current) {
        pendingKeyboardStopRef.current = false;
        window.setTimeout(stopRecording, 0);
      }
    }

    function enterListening() {
      dispatch({ type: "RECORDING_STARTED", eventId });
      onRuntimeEvent({ type: "agent.listening_started", eventId });
    }

    function startBatchRecorder(stream: MediaStream) {
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      chunksRef.current = [];

      recorder.addEventListener("dataavailable", (event) => {
        voiceDebug("recorder data", { eventId, size: event.data.size });
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      });
      recorder.addEventListener(
        "stop",
        () => {
          voiceDebug("recorder stopped", {
            eventId,
            chunks: chunksRef.current.length,
            mimeType: recorder.mimeType,
          });
          stopRecordingStream(recorder);
          const blob = new Blob(chunksRef.current, {
            type: recorder.mimeType || "audio/webm",
          });
          chunksRef.current = [];
          recorderRef.current = null;

          if (blob.size <= 0) {
            voiceDebug("recording empty", { eventId });
            completeListening(eventId);
            dispatch({ type: "FAILED", eventId, error: "No voice input was captured." });
            return;
          }

          voiceDebug("recording ready", { eventId, bytes: blob.size, type: blob.type });
          void processRecording(eventId, blob);
        },
        { once: true },
      );

      recorder.start();
      voiceDebug("recorder started", {
        eventId,
        state: recorder.state,
        mimeType: recorder.mimeType,
      });
    }

    try {
      await logAudioInputDevices("before permission");
      const stream = await requestVoiceAudioStream();
      voiceDebug("audio stream acquired", {
        eventId,
        tracks: stream.getAudioTracks().map((track) => ({
          id: track.id,
          label: track.label,
          enabled: track.enabled,
          muted: track.muted,
          readyState: track.readyState,
        })),
      });

      if (isRealtimeVoiceRecordingSupported()) {
        // Show "listening" and start capturing immediately so the realtime
        // websocket handshake latency is invisible and no speech is dropped
        // while the connection is established in the background.
        startRealtimeFallbackCapture({
          eventId,
          stream,
          recorderRef: realtimeFallbackRecorderRef,
          chunksRef: realtimeFallbackChunksRef,
          stopPromiseRef: realtimeFallbackStopRef,
        });
        enterListening();

        const realtimeStarted = await startRealtimeRecordingSession(eventId, stream);
        if (realtimeStarted) {
          voiceDebug("realtime recorder started", { eventId });
          scheduleRecordingStop();
          return;
        }

        voiceDebug("realtime unavailable; using batch recorder", { eventId });
        cancelRealtimeFallbackCapture({
          recorderRef: realtimeFallbackRecorderRef,
          chunksRef: realtimeFallbackChunksRef,
          stopPromiseRef: realtimeFallbackStopRef,
        });
        startBatchRecorder(stream);
        scheduleRecordingStop();
        return;
      }

      startBatchRecorder(stream);
      enterListening();
      scheduleRecordingStop();
    } catch (error) {
      voiceDebug("recording failed", { eventId, error: describeVoiceError(error) });
      onRuntimeEvent({
        type: "runtime.cancelled",
        eventId,
        reason: "voice_microphone_unavailable",
      });
      dispatch({ type: "FAILED", eventId, error: voiceRecordingErrorMessage(error) });
      void logAudioInputDevices("after failure");
    }
  }, [
    completeListening,
    onRuntimeEvent,
    processRecording,
    session,
    startRealtimeRecordingSession,
    stopRecording,
  ]);

  const beginPushToTalk = useCallback(() => {
    if (!enabled || !session) {
      voiceDebug("begin ignored: inactive", {
        enabled,
        hasSession: Boolean(session),
      });
      return;
    }

    const currentPhase = stateRef.current.phase;
    if (
      currentPhase === "requesting_permission" ||
      currentPhase === "recording_push_to_talk" ||
      currentPhase === "transcribing" ||
      currentPhase === "thinking"
    ) {
      voiceDebug("begin ignored: busy", { phase: currentPhase });
      return;
    }

    const eventId = createVoiceEventId();
    voiceDebug("begin push-to-talk", { eventId, phase: currentPhase });
    if (currentPhase === "speaking") {
      activeStreamAbortRef.current?.abort();
      onRuntimeEvent({ type: "runtime.cancelled", reason: "voice_interrupted" });
      dispatch({ type: "INTERRUPTED", eventId });
    }

    void startRecordingSession(eventId);
  }, [enabled, onRuntimeEvent, session, startRecordingSession]);

  const endPushToTalk = useCallback(() => {
    voiceDebug("end push-to-talk", {
      recorderState: recorderRef.current?.state ?? null,
      phase: stateRef.current.phase,
    });
    stopRecording();
  }, [stopRecording]);

  useEffect(() => {
    function handleInactiveSpace(event: KeyboardEvent) {
      if (event.code === PUSH_TO_TALK_KEY_CODE && (!enabled || !session)) {
        voiceDebug("space ignored: inactive shortcut", {
          enabled,
          hasSession: Boolean(session),
          target: describeEventTarget(event.target),
        });
      }
    }

    window.addEventListener("keydown", handleInactiveSpace, { capture: true });
    return () => window.removeEventListener("keydown", handleInactiveSpace, { capture: true });
  }, [enabled, session]);

  useEffect(() => {
    if (!enabled || !session) {
      pendingKeyboardStopRef.current = false;
      voiceDebug("shortcut detached", { enabled, hasSession: Boolean(session) });
      return;
    }

    voiceDebug("shortcut attached", {
      mode: "toggle",
      phase: stateRef.current.phase,
    });

    function handleKeyDown(event: KeyboardEvent) {
      if (event.code !== PUSH_TO_TALK_KEY_CODE) {
        return;
      }

      const target = describeEventTarget(event.target);
      if (isKeyboardShortcutTargetIgnored(event.target)) {
        voiceDebug("space ignored: focused control", { target });
        return;
      }

      event.preventDefault();
      const action = resolvePushToTalkKeyboardAction({
        phase: stateRef.current.phase,
        eventType: "keydown",
        repeat: event.repeat,
      });
      voiceDebug("space keydown", {
        action,
        mode: "toggle",
        phase: stateRef.current.phase,
        repeat: event.repeat,
        target,
      });

      if (action === "stop") {
        pendingKeyboardStopRef.current = true;
        endPushToTalk();
        return;
      }

      if (action === "start") {
        pendingKeyboardStopRef.current = false;
        beginPushToTalk();
      }
    }

    function handleKeyUp(event: KeyboardEvent) {
      if (event.code !== PUSH_TO_TALK_KEY_CODE) {
        return;
      }

      const target = describeEventTarget(event.target);
      const action = resolvePushToTalkKeyboardAction({
        phase: stateRef.current.phase,
        eventType: "keyup",
        repeat: event.repeat,
      });
      voiceDebug("space keyup", {
        action,
        mode: "toggle",
        phase: stateRef.current.phase,
        repeat: event.repeat,
        target,
      });
    }

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      pendingKeyboardStopRef.current = false;
      voiceDebug("shortcut detached", { enabled, hasSession: Boolean(session) });
    };
  }, [beginPushToTalk, enabled, endPushToTalk, session]);

  const cancelVoiceTurn = useCallback(() => {
    activeStreamAbortRef.current?.abort();
    realtimeTranscriberRef.current?.cancel();
    realtimeTranscriberRef.current = null;
    cancelRealtimeFallbackCapture({
      recorderRef: realtimeFallbackRecorderRef,
      chunksRef: realtimeFallbackChunksRef,
      stopPromiseRef: realtimeFallbackStopRef,
    });
    const eventId = stateRef.current.activeEventId;
    onRuntimeEvent({
      type: "runtime.cancelled",
      eventId: eventId ?? undefined,
      reason: "voice_cancelled",
    });
    stopRecording();
    dispatch({ type: "IDLE" });
  }, [onRuntimeEvent, stopRecording]);

  const saveSettings = useCallback(async (input: {
    wakeEnabled?: boolean;
    wakePhrase?: string | null;
  }) => {
    if (!session) {
      return;
    }

    dispatch({ type: "SETTINGS_SAVING" });
    try {
      const settings = await updateVoiceSettings(
        {
          ...input,
          clientWakeSupported: stateRef.current.wakeSupported,
        },
        session,
        onSessionRefreshed,
      );
      dispatch({ type: "SETTINGS_UPDATED", settings });
    } catch (error) {
      dispatch({ type: "SETTINGS_FAILED", error: errorMessage(error) });
    }
  }, [onSessionRefreshed, session]);

  useEffect(() => {
    if (
      !enabled ||
      !session ||
      state.phase !== "armed_wake" ||
      !state.settings?.wakeEnabled ||
      !state.wakeSupported
    ) {
      recognitionRef.current?.stop();
      recognitionRef.current = null;
      return;
    }

    const Recognition = getSpeechRecognitionConstructor();
    if (!Recognition) {
      return;
    }

    const recognition = new Recognition();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = "en-US";
    recognition.onresult = (event) => {
      const text = speechRecognitionText(event);
      if (!includesWakePhrase(text, state.settings?.wakePhrase ?? "")) {
        return;
      }

      const eventId = createVoiceEventId();
      dispatch({ type: "WAKE_DETECTED", eventId });
      recognition.stop();
      void startRecordingSession(eventId, { autoStopMs: WAKE_RECORDING_MS });
    };
    recognition.onerror = () => undefined;
    recognition.onend = () => {
      if (stateRef.current.phase === "armed_wake") {
        try {
          recognition.start();
        } catch {
          // Browsers throw if recognition is already starting.
        }
      }
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      return;
    }

    return () => {
      recognition.stop();
      if (recognitionRef.current === recognition) {
        recognitionRef.current = null;
      }
    };
  }, [
    enabled,
    session,
    startRecordingSession,
    state.phase,
    state.settings?.wakeEnabled,
    state.settings?.wakePhrase,
    state.wakeSupported,
  ]);

  useEffect(() => {
    return () => {
      const activeStreamAbort = activeStreamAbortRef.current;
      const recognition = recognitionRef.current;
      const recorder = recorderRef.current;
      const realtimeFallbackRecorder = realtimeFallbackRecorderRef.current;
      const realtimeTranscriber = realtimeTranscriberRef.current;
      activeStreamAbortRef.current = null;
      recognitionRef.current = null;
      recorderRef.current = null;
      realtimeFallbackRecorderRef.current = null;
      realtimeTranscriberRef.current = null;

      if (autoStopTimerRef.current !== null) {
        window.clearTimeout(autoStopTimerRef.current);
        autoStopTimerRef.current = null;
      }
      activeStreamAbort?.abort();
      recognition?.stop();
      realtimeTranscriber?.cancel();
      if (realtimeFallbackRecorder?.state === "recording") {
        realtimeFallbackRecorder.stop();
      }
      if (recorder?.state === "recording") {
        recorder.stop();
      } else {
        recorder?.stream.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  return {
    beginPushToTalk,
    cancelVoiceTurn,
    endPushToTalk,
    saveSettings,
    state,
  };
}

async function streamVoiceTurn(input: {
  eventId: string;
  content: string;
  session: Session;
  activeThreadId: string | null;
  onSessionRefreshed: (session: Session) => void;
  onRuntimeEvent: (event: TwinRuntimeEvent) => void;
  dispatch: Dispatch<import("@/lib/voice/voice-chat-reducer").HomepageVoiceAction>;
  activeStreamAbortRef: RefObject<AbortController | null>;
}) {
  const threadId = input.activeThreadId ??
    (await createThread(
      "Voice chat",
      input.session,
      input.onSessionRefreshed,
      VOICE_CHAT_SURFACE,
    )).thread.id;
  const abortController = new AbortController();
  input.activeStreamAbortRef.current = abortController;
  const realtimeSynthesisSession = await createRealtimeVoiceSynthesisSession(
    input.session,
    input.onSessionRefreshed,
  );

  const audioPlayer = createRealtimePcmAudioPlayer({
    sampleRate: realtimeSynthesisSession.sampleRate,
    onStarted: () => {
      input.onRuntimeEvent({ type: "agent.thinking_completed", eventId: input.eventId });
      input.dispatch({ type: "SPEAKING", eventId: input.eventId });
    },
  });

  const streamer = createCartesiaRealtimeTextToSpeechClient({
    session: realtimeSynthesisSession,
    signal: abortController.signal,
    onAudioChunk(bytes) {
      audioPlayer.pushPcm16(bytes);
    },
    onStreamClosed: () => {
      audioPlayer.close();
    },
  });

  let buffer = "";
  let committed = 0;
  let finalAssistantText = "";

  try {
    await streamer.ready;
    await streamChatTurn({
      threadId,
      content: input.content,
      memoryIntent: "auto",
      surface: VOICE_CHAT_SURFACE,
      session: input.session,
      onSessionRefreshed: input.onSessionRefreshed,
      signal: abortController.signal,
      onEvent: (event) => {
        if (event.type === "assistant.delta") {
          input.dispatch({
            type: "ASSISTANT_DELTA",
            eventId: input.eventId,
            delta: event.delta,
          });
          buffer += event.delta;
          finalAssistantText += event.delta;
          committed = flushSentenceChunks(buffer, committed, (sentence) =>
            streamer.push(sentence),
          );
          return;
        }

        if (event.type === "assistant.completed") {
          finalAssistantText = event.assistantMessage.content;
          return;
        }

        if (event.type === "turn.failed") {
          throw new Error(event.error.message);
        }
      },
    });

    const responseText = finalAssistantText.trim();
    if (!responseText) {
      throw new Error("The assistant did not return a voice response.");
    }

    const remainder = buffer.slice(committed).trim();
    if (remainder) {
      streamer.push(remainder);
    } else if (!buffer.trim()) {
      // Provider returned the answer without streaming deltas.
      streamer.push(responseText);
    }

    input.dispatch({
      type: "ASSISTANT_READY",
      eventId: input.eventId,
      text: responseText,
      threadId,
    });

    streamer.close();
    await streamer.done;
    audioPlayer.close();
    await audioPlayer.done;

    if (abortController.signal.aborted) {
      return;
    }

    if (!audioPlayer.started) {
      throw new Error(
        streamer.error?.message ?? "The assistant could not produce speech audio.",
      );
    }

    input.dispatch({ type: "SPEECH_ENDED" });
  } catch (error) {
    abortController.abort();
    streamer.cancel();
    audioPlayer.cancel();
    throw error;
  } finally {
    input.activeStreamAbortRef.current = null;
  }
}

const MIN_SPOKEN_CHUNK_CHARS = 18;
const MAX_UNSPOKEN_CHUNK_CHARS = 120;
const SENTENCE_BOUNDARY = /[.!?…]+(?=["')\]]*(\s|$))|\n+/g;

// Emit completed sentences from a growing transcript buffer, merging fragments
// shorter than the minimum so we do not fire a synthesis request per word.
function flushSentenceChunks(
  buffer: string,
  fromIndex: number,
  emit: (sentence: string) => void,
): number {
  SENTENCE_BOUNDARY.lastIndex = fromIndex;
  let committed = fromIndex;
  let match: RegExpExecArray | null;

  while ((match = SENTENCE_BOUNDARY.exec(buffer)) !== null) {
    const end = match.index + match[0].length;
    const chunk = buffer.slice(committed, end).trim();
    if (chunk.length >= MIN_SPOKEN_CHUNK_CHARS) {
      emit(chunk);
      committed = end;
    }

    if (SENTENCE_BOUNDARY.lastIndex <= match.index) {
      SENTENCE_BOUNDARY.lastIndex = match.index + 1;
    }
  }

  const nextCommitted = flushLongPhraseChunk(buffer, committed, emit);
  return nextCommitted;
}

function flushLongPhraseChunk(
  buffer: string,
  fromIndex: number,
  emit: (chunk: string) => void,
): number {
  const pending = buffer.slice(fromIndex);
  if (pending.length < MAX_UNSPOKEN_CHUNK_CHARS) {
    return fromIndex;
  }

  const preferred = pending.search(/[,;:]\s/u);
  const boundary = preferred >= MIN_SPOKEN_CHUNK_CHARS
    ? preferred + 1
    : lastWordBoundaryBefore(pending, MAX_UNSPOKEN_CHUNK_CHARS);

  if (boundary < MIN_SPOKEN_CHUNK_CHARS) {
    return fromIndex;
  }

  const chunk = pending.slice(0, boundary).trim();
  if (chunk.length < MIN_SPOKEN_CHUNK_CHARS) {
    return fromIndex;
  }

  emit(chunk);
  return fromIndex + boundary;
}

function lastWordBoundaryBefore(value: string, maxIndex: number) {
  const limited = value.slice(0, maxIndex);
  const boundary = limited.lastIndexOf(" ");
  return boundary > 0 ? boundary : maxIndex;
}

function startRealtimeFallbackCapture(input: {
  eventId: string;
  stream: MediaStream;
  recorderRef: RefObject<MediaRecorder | null>;
  chunksRef: RefObject<Blob[]>;
  stopPromiseRef: RefObject<Promise<Blob | null> | null>;
}) {
  if (typeof globalThis.MediaRecorder !== "function") {
    voiceDebug("realtime fallback recorder unavailable", { eventId: input.eventId });
    return;
  }

  try {
    const recorder = new MediaRecorder(input.stream);
    input.chunksRef.current = [];

    const stopped = new Promise<Blob | null>((resolve) => {
      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) {
          input.chunksRef.current.push(event.data);
        }
      });

      recorder.addEventListener(
        "stop",
        () => {
          const blob = input.chunksRef.current.length > 0
            ? new Blob(input.chunksRef.current, {
              type: recorder.mimeType || "audio/webm",
            })
            : null;
          input.chunksRef.current = [];
          if (input.recorderRef.current === recorder) {
            input.recorderRef.current = null;
          }
          if (input.stopPromiseRef.current === stopped) {
            input.stopPromiseRef.current = null;
          }
          resolve(blob);
        },
        { once: true },
      );
    });

    recorder.start();
    input.recorderRef.current = recorder;
    input.stopPromiseRef.current = stopped;
  } catch (error) {
    input.chunksRef.current = [];
    input.recorderRef.current = null;
    input.stopPromiseRef.current = null;
    voiceDebug("realtime fallback recorder failed", {
      eventId: input.eventId,
      error: describeVoiceError(error),
    });
  }
}

function stopRealtimeFallbackCapture(input: {
  recorderRef: RefObject<MediaRecorder | null>;
  chunksRef: RefObject<Blob[]>;
  stopPromiseRef: RefObject<Promise<Blob | null> | null>;
}) {
  const recorder = input.recorderRef.current;
  const stopped = input.stopPromiseRef.current;

  if (!recorder) {
    return Promise.resolve<Blob | null>(null);
  }

  if (recorder.state === "recording") {
    recorder.stop();
    return stopped ?? Promise.resolve<Blob | null>(null);
  }

  input.recorderRef.current = null;
  input.chunksRef.current = [];
  input.stopPromiseRef.current = null;
  return stopped ?? Promise.resolve<Blob | null>(null);
}

function cancelRealtimeFallbackCapture(input: {
  recorderRef: RefObject<MediaRecorder | null>;
  chunksRef: RefObject<Blob[]>;
  stopPromiseRef: RefObject<Promise<Blob | null> | null>;
}) {
  const recorder = input.recorderRef.current;
  input.recorderRef.current = null;
  input.chunksRef.current = [];
  input.stopPromiseRef.current = null;

  if (recorder?.state === "recording") {
    recorder.stop();
  }
}

function isVoiceRecordingSupported() {
  return Boolean(
    typeof navigator.mediaDevices?.getUserMedia === "function" &&
      (typeof globalThis.MediaRecorder === "function" || isRealtimeVoiceRecordingSupported()),
  );
}

function isRealtimeVoiceRecordingSupported() {
  return typeof globalThis.AudioContext === "function" ||
    typeof (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext === "function";
}

async function requestVoiceAudioStream() {
  try {
    voiceDebug("getUserMedia requested", { constraints: { audio: true } });
    return await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (error) {
    voiceDebug("getUserMedia failed", { error: describeVoiceError(error) });
    const fallbackStream = await requestAvailableAudioInputStream(error);
    if (fallbackStream) {
      return fallbackStream;
    }

    throw error;
  }
}

async function requestAvailableAudioInputStream(error: unknown) {
  if (!isMissingAudioInputError(error) || !navigator.mediaDevices.enumerateDevices) {
    return null;
  }

  const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
  const audioInputs = devices.filter(
    (device) => device.kind === "audioinput" && device.deviceId,
  );
  voiceDebug("audio fallback candidates", {
    count: audioInputs.length,
    devices: audioInputs.map(formatMediaDeviceInfo),
  });

  const fallbackResults = await Promise.all(
    audioInputs.slice(0, 4).map(async (device) => {
      voiceDebug("getUserMedia fallback requested", {
        device: formatMediaDeviceInfo(device),
      });
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: { exact: device.deviceId },
        },
      }).catch((fallbackError: unknown) => {
        voiceDebug("getUserMedia fallback failed", {
          device: formatMediaDeviceInfo(device),
          error: describeVoiceError(fallbackError),
        });
        return null;
      });

      return { device, stream };
    }),
  );

  const fallbackResult = fallbackResults.find((result) => result.stream);
  if (fallbackResult?.stream) {
    voiceDebug("getUserMedia fallback acquired", {
      device: formatMediaDeviceInfo(fallbackResult.device),
    });
    return fallbackResult.stream;
  }

  return null;
}

export function voiceRecordingErrorMessage(error: unknown) {
  if (isMissingAudioInputError(error)) {
    return "No microphone was found. Connect or enable an input device, then press Space again.";
  }

  if (isPermissionDeniedError(error)) {
    return "Microphone access is blocked. Allow microphone permission in your browser settings, then press Space again.";
  }

  return errorMessage(error);
}

function isMissingAudioInputError(error: unknown) {
  return isNamedDomError(error, ["NotFoundError", "DevicesNotFoundError"]) ||
    errorMessage(error).toLowerCase().includes("requested device not found");
}

function isPermissionDeniedError(error: unknown) {
  return isNamedDomError(error, ["NotAllowedError", "PermissionDeniedError"]);
}

function isAbortError(error: unknown) {
  return isNamedDomError(error, ["AbortError"]) ||
    errorMessage(error).toLowerCase().includes("abort");
}

function describeVoiceError(error: unknown) {
  if (error instanceof DOMException) {
    return {
      name: error.name,
      message: error.message,
      code: error.code,
    };
  }

  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
    };
  }

  return { message: errorMessage(error) };
}

function isNamedDomError(error: unknown, names: string[]) {
  return error instanceof DOMException
    ? names.includes(error.name)
    : typeof error === "object" &&
        error !== null &&
        "name" in error &&
        names.includes(String(error.name));
}

function isWakePhraseSupported() {
  return Boolean(getSpeechRecognitionConstructor());
}

export function resolvePushToTalkKeyboardAction(input: {
  phase: ReturnType<typeof createInitialHomepageVoiceState>["phase"];
  eventType: "keydown" | "keyup";
  repeat: boolean;
}): "ignore" | "start" | "stop" {
  if (input.eventType === "keyup" || input.repeat) {
    return "ignore";
  }

  return input.phase === "recording_push_to_talk" ||
    input.phase === "requesting_permission"
    ? "stop"
    : "start";
}

function isKeyboardShortcutTargetIgnored(target: EventTarget | null) {
  if (!(target instanceof Element)) {
    return false;
  }

  return Boolean(
    target.closest(
      "input, textarea, select, button, a, [contenteditable='true'], [role='textbox']",
    ),
  );
}

function describeEventTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) {
    return null;
  }

  return {
    tagName: target.tagName.toLowerCase(),
    id: target.id || null,
    className: typeof target.className === "string" ? target.className : null,
    role: target.getAttribute("role"),
    ariaLabel: target.getAttribute("aria-label"),
    contentEditable: target.getAttribute("contenteditable"),
  };
}

async function logAudioInputDevices(stage: string) {
  if (!navigator.mediaDevices?.enumerateDevices) {
    voiceDebug("audio devices unavailable", { stage });
    return;
  }

  const devices = await navigator.mediaDevices.enumerateDevices().catch((error: unknown) => {
    voiceDebug("audio devices failed", { stage, error: describeVoiceError(error) });
    return [];
  });
  const audioInputs = devices.filter((device) => device.kind === "audioinput");
  voiceDebug("audio devices", {
    stage,
    audioInputCount: audioInputs.length,
    devices: audioInputs.map(formatMediaDeviceInfo),
  });
}

function formatMediaDeviceInfo(device: MediaDeviceInfo) {
  return {
    kind: device.kind,
    label: device.label || "(label hidden until permission)",
    deviceId: device.deviceId ? `${device.deviceId.slice(0, 8)}...` : "",
    groupId: device.groupId ? `${device.groupId.slice(0, 8)}...` : "",
  };
}

function voiceDebug(event: string, details: Record<string, unknown> = {}) {
  console.info("[voice-chat]", event, details);
}

function getSpeechRecognitionConstructor(): SpeechRecognitionConstructor | null {
  const candidate = globalThis as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };

  return candidate.SpeechRecognition ?? candidate.webkitSpeechRecognition ?? null;
}

function stopRecordingStream(recorder: MediaRecorder) {
  recorder.stream.getTracks().forEach((track) => track.stop());
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

function createVoiceEventId() {
  return `voice-${globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36)}`;
}

function speechRecognitionText(event: SpeechRecognitionEventLike) {
  const parts: string[] = [];
  for (let index = 0; index < event.results.length; index += 1) {
    const result = event.results[index];
    const phrase = result?.[0]?.transcript;
    if (phrase) {
      parts.push(phrase);
    }
  }
  return parts.join(" ");
}

function includesWakePhrase(text: string, wakePhrase: string) {
  return normalizeWakeText(text).includes(normalizeWakeText(wakePhrase));
}

function normalizeWakeText(value: string) {
  return value.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}
