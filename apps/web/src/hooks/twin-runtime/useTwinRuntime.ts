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
    if (runtimeState.status !== "preparing_speech" || !session) {
      return;
    }

    const requestedSpeechEventIds = getRequestedSpeechEventIds();
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

        getRequestedSpeechEventIds().delete(runtimeState.eventId);
        dispatchRuntimeAction({
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
    runtimeState,
    session,
    setSession,
  ]);

  useEffect(() => {
    return () => revokeAudioUrls(audioUrls);
  }, [audioUrls]);

  async function consumeRuntimeEvent(eventId: string) {
    if (!session) {
      return;
    }

    await postAuthedJson(
      `/v1/twins/${session.twinId}/identity-profile/first-meet-intro/consumed`,
      {},
      session,
      setSession,
    );

    getRequestedSpeechEventIds().delete(eventId);
    dispatchRuntimeAction({ type: "speech.completed", eventId });

    const currentState = runtimeStateRef.current;

    if (currentState.status !== "speaking" || currentState.eventId !== eventId) {
      return;
    }

    URL.revokeObjectURL(currentState.audioUrl);
    audioUrls.delete(currentState.audioUrl);
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
