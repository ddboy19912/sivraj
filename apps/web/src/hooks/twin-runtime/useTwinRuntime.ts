import { useEffect, useReducer, useRef, useState } from "react";
import { postAuthedAudio, postAuthedJson } from "@/lib/api";
import {
  createInitialTwinRuntimeState,
  twinRuntimeReducer,
} from "@/lib/twin/runtime-reducer";
import { getSpeechPlaybackCommand } from "@/lib/twin/runtime-selectors";
import type {
  TwinRuntimeController,
  TwinRuntimeInput,
} from "@/types/twin.types";

const SPEECH_REQUEST_TIMEOUT_MS = 45_000;

export function useTwinRuntime({
  events,
  session,
  setSession,
}: TwinRuntimeInput): TwinRuntimeController {
  const [runtimeState, dispatchRuntimeAction] = useReducer(
    twinRuntimeReducer,
    undefined,
    createInitialTwinRuntimeState,
  );
  const requestedSpeechEventIdsRef = useRef<Set<string> | null>(null);
  const [audioUrls] = useState(() => new Set<string>());
  const runtimeStateRef = useRef(runtimeState);
  const sessionRef = useRef(session);
  const setSessionRef = useRef(setSession);
  const speechEventId =
    runtimeState.status === "preparing_speech" ? runtimeState.eventId : null;
  const speechFailureMode =
    runtimeState.status === "preparing_speech"
      ? runtimeState.failureMode
      : undefined;
  const speechText =
    runtimeState.status === "preparing_speech" ? runtimeState.text : null;
  const speechVoiceStyle =
    runtimeState.status === "preparing_speech"
      ? runtimeState.voiceStyle
      : null;
  const sessionTwinId = session?.twinId ?? null;

  function getRequestedSpeechEventIds() {
    if (requestedSpeechEventIdsRef.current === null) {
      requestedSpeechEventIdsRef.current = new Set();
    }

    return requestedSpeechEventIdsRef.current;
  }

  function dispatchRuntimeEvent(event: TwinRuntimeInput["events"][number]) {
    if (event.type === "speech.failed") {
      getRequestedSpeechEventIds().delete(event.eventId);
    }

    dispatchRuntimeAction(event);
  }

  useEffect(() => {
    runtimeStateRef.current = runtimeState;
  }, [runtimeState]);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    setSessionRef.current = setSession;
  }, [setSession]);

  useEffect(() => {
    for (const event of events) {
      const eventId = getRuntimeEventId(event);

      if (!eventId) {
        continue;
      }

      if (event.type === "speech.failed") {
        getRequestedSpeechEventIds().delete(event.eventId);
      }

      dispatchRuntimeAction(event);
    }
  }, [events]);

  useEffect(() => {
    if (!speechEventId || !speechText || !speechVoiceStyle || !sessionTwinId) {
      return;
    }

    const activeSession = sessionRef.current;
    if (!activeSession || activeSession.twinId !== sessionTwinId) {
      return;
    }

    const eventId = speechEventId;
    const failureMode = speechFailureMode;
    const text = speechText;
    const voiceStyle = speechVoiceStyle;
    const requestedSpeechEventIds = getRequestedSpeechEventIds();
    if (requestedSpeechEventIds.has(eventId)) {
      return;
    }

    requestedSpeechEventIds.add(eventId);
    let cancelled = false;
    let timedOut = false;
    const abortController = new AbortController();
    const timeout = window.setTimeout(() => {
      if (cancelled) {
        return;
      }

      timedOut = true;
      getRequestedSpeechEventIds().delete(eventId);
      abortController.abort();
      if (failureMode === "quiet") {
        console.error("Home greeting speech timed out.");
      }
      dispatchRuntimeAction({
        type: "speech.failed",
        eventId,
        failureMode,
        reason: "Speech generation timed out.",
      });
    }, SPEECH_REQUEST_TIMEOUT_MS);

    void postAuthedAudio(
      `/v1/twins/${sessionTwinId}/voice/speak`,
      {
        text,
        style: voiceStyle,
        exaggeration: 0.72,
      },
      activeSession,
      setSessionRef.current,
      abortController.signal,
    )
      .then((audio) => {
        if (cancelled || timedOut) {
          return;
        }

        const audioUrl = URL.createObjectURL(audio);
        audioUrls.add(audioUrl);
        dispatchRuntimeAction({
          type: "speech.audio_ready",
          eventId,
          audioUrl,
        });
      })
      .catch((error: unknown) => {
        if (cancelled || timedOut) {
          return;
        }

        getRequestedSpeechEventIds().delete(eventId);
        if (failureMode === "quiet") {
          console.error("Home greeting speech failed.", error);
        }
        dispatchRuntimeAction({
          type: "speech.failed",
          eventId,
          failureMode,
          reason: error instanceof Error ? error.message : "Speech failed.",
        });
      })
      .finally(() => {
        window.clearTimeout(timeout);
      });

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      abortController.abort();
    };
  }, [
    audioUrls,
    sessionTwinId,
    speechEventId,
    speechFailureMode,
    speechText,
    speechVoiceStyle,
  ]);

  useEffect(() => {
    return () => revokeAudioUrls(audioUrls);
  }, [audioUrls]);

  async function consumeRuntimeEvent(eventId: string) {
    if (!session) {
      return;
    }

    const currentState = runtimeStateRef.current;
    const shouldConsumeFirstMeetIntro =
      currentState.status === "speaking" &&
      currentState.eventId === eventId &&
      currentState.sourceEventId === eventId;

    if (shouldConsumeFirstMeetIntro) {
      await postAuthedJson(
        `/v1/twins/${session.twinId}/identity-profile/first-meet-intro/consumed`,
        {},
        session,
        setSession,
      );
    }

    getRequestedSpeechEventIds().delete(eventId);
    dispatchRuntimeAction({ type: "speech.completed", eventId });

    if (currentState.status !== "speaking" || currentState.eventId !== eventId) {
      return;
    }

    for (const clipUrl of currentState.clips) {
      URL.revokeObjectURL(clipUrl);
      audioUrls.delete(clipUrl);
    }
  }

  return {
    runtimeState,
    dispatchRuntimeEvent,
    speechPlaybackCommand: getSpeechPlaybackCommand(runtimeState),
    consumeRuntimeEvent,
  };
}

function getRuntimeEventId(
  event: TwinRuntimeInput["events"][number],
): string | null {
  return "eventId" in event && event.eventId ? event.eventId : null;
}

function revokeAudioUrls(audioUrls: Set<string> | null): void {
  if (!audioUrls) {
    return;
  }

  for (const audioUrl of audioUrls) {
    URL.revokeObjectURL(audioUrl);
  }

  audioUrls.clear();
}
