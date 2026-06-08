import { useCallback, useEffect, useReducer, useRef } from "react";
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
  const audioUrlsRef = useRef<Set<string> | null>(null);
  const runtimeStateRef = useRef(runtimeState);
  const requestedSpeechEventIds = getOrCreateSet(requestedSpeechEventIdsRef);
  const audioUrls = getOrCreateSet(audioUrlsRef);

  const dispatchRuntimeEvent = useCallback(
    (event: TwinRuntimeInput["events"][number]) => {
      if (event.type === "speech.failed") {
        requestedSpeechEventIds.delete(event.eventId);
      }

      dispatchRuntimeAction(event);
    },
    [requestedSpeechEventIds],
  );

  useEffect(() => {
    runtimeStateRef.current = runtimeState;
  }, [runtimeState]);

  useEffect(() => {
    for (const event of events) {
      const eventId = getRuntimeEventId(event);

      if (!eventId) {
        continue;
      }

      dispatchRuntimeEvent(event);
    }
  }, [dispatchRuntimeEvent, events]);

  useEffect(() => {
    if (runtimeState.status !== "preparing_speech" || !session) {
      return;
    }

    if (requestedSpeechEventIds.has(runtimeState.eventId)) {
      return;
    }

    requestedSpeechEventIds.add(runtimeState.eventId);
    let cancelled = false;

    void postAuthedAudio(
      `/v1/twins/${session.twinId}/voice/speak`,
      {
        text: runtimeState.text,
        style: runtimeState.voiceStyle,
        exaggeration: 0.72,
      },
      session,
      setSession,
    )
      .then((audio) => {
        if (cancelled) {
          return;
        }

        const audioUrl = URL.createObjectURL(audio);
        audioUrls.add(audioUrl);
        dispatchRuntimeAction({
          type: "speech.audio_ready",
          eventId: runtimeState.eventId,
          audioUrl,
        });
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }

        dispatchRuntimeEvent({
          type: "speech.failed",
          eventId: runtimeState.eventId,
          reason: error instanceof Error ? error.message : "Speech failed.",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [
    audioUrls,
    dispatchRuntimeEvent,
    requestedSpeechEventIds,
    runtimeState,
    session,
    setSession,
  ]);

  useEffect(() => {
    return () => {
      for (const audioUrl of audioUrls) {
        URL.revokeObjectURL(audioUrl);
      }
      audioUrls.clear();
    };
  }, [audioUrls]);

  const consumeRuntimeEvent = useCallback(
    async (eventId: string) => {
      if (!session) {
        return;
      }

      await postAuthedJson(
        `/v1/twins/${session.twinId}/identity-profile/first-meet-intro/consumed`,
        {},
        session,
        setSession,
      );

      requestedSpeechEventIds.delete(eventId);
      dispatchRuntimeAction({ type: "speech.completed", eventId });

      const currentState = runtimeStateRef.current;

      if (currentState.status !== "speaking" || currentState.eventId !== eventId) {
        return;
      }

      URL.revokeObjectURL(currentState.audioUrl);
      audioUrls.delete(currentState.audioUrl);
    },
    [audioUrls, requestedSpeechEventIds, session, setSession],
  );

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

function getOrCreateSet(ref: { current: Set<string> | null }): Set<string> {
  if (ref.current === null) {
    ref.current = new Set();
  }

  return ref.current;
}
