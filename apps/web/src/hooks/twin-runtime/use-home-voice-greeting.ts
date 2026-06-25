import { useEffect, useEffectEvent, useRef } from "react";
import {
  buildHomeSessionGreeting,
  homeSessionGreetingEventId,
  markHomeSessionGreetingAttempted,
  readHomeSessionGreetingId,
} from "@/lib/twin/home-greeting";
import type { Session } from "@/lib/session";
import type { TwinRuntimeEvent, TwinRuntimeState } from "@/types/twin.types";
import type { HomepageVoicePhase } from "@/types/voice.types";

type UseHomeVoiceGreetingInput = {
  enabled: boolean;
  session: Session | null;
  displayName: string | null;
  firstMeetIntroStatus: "not_started" | "issued" | "consumed";
  runtimeState: TwinRuntimeState;
  voicePhase: HomepageVoicePhase | null;
  onRuntimeEvent: (event: TwinRuntimeEvent) => void;
};

type ClaimHomeVoiceGreetingInput = {
  enabled: boolean;
  twinId: string | null;
  displayName: string | null;
  firstMeetIntroStatus: "not_started" | "issued" | "consumed";
  runtimeStatus: TwinRuntimeState["status"];
  voicePhase: HomepageVoicePhase | null;
  attemptedTwinIds: Set<string>;
};

export function useHomeVoiceGreeting({
  enabled,
  session,
  displayName,
  firstMeetIntroStatus,
  runtimeState,
  voicePhase,
  onRuntimeEvent,
}: UseHomeVoiceGreetingInput): void {
  const attemptedTwinIdsRef = useRef<Set<string> | null>(null);
  const dispatchRuntimeEvent = useEffectEvent(onRuntimeEvent);

  function getAttemptedTwinIds() {
    if (attemptedTwinIdsRef.current === null) {
      attemptedTwinIdsRef.current = new Set();
    }

    return attemptedTwinIdsRef.current;
  }

  useEffect(() => {
    const greetingEvent = claimHomeVoiceGreetingEvent({
      enabled,
      twinId: session?.twinId ?? null,
      displayName,
      firstMeetIntroStatus,
      runtimeStatus: runtimeState.status,
      voicePhase,
      attemptedTwinIds: getAttemptedTwinIds(),
    });
    greetingEvent ? dispatchRuntimeEvent(greetingEvent) : undefined;
  }, [
    displayName,
    enabled,
    firstMeetIntroStatus,
    runtimeState.status,
    session,
    voicePhase,
  ]);
}

function claimHomeVoiceGreetingEvent({
  enabled,
  twinId,
  displayName,
  firstMeetIntroStatus,
  runtimeStatus,
  voicePhase,
  attemptedTwinIds,
}: ClaimHomeVoiceGreetingInput): TwinRuntimeEvent | null {
  const greetingName = displayName?.trim();
  if (
    !enabled ||
    !twinId ||
    !greetingName ||
    runtimeStatus !== "idle" ||
    firstMeetIntroStatus === "issued" ||
    !isGreetingAllowedVoicePhase(voicePhase)
  ) {
    return null;
  }

  if (attemptedTwinIds.has(twinId)) {
    return null;
  }

  const previousGreetingId = readHomeSessionGreetingId({ twinId });
  if (previousGreetingId) {
    attemptedTwinIds.add(twinId);
    return null;
  }

  const greeting = buildHomeSessionGreeting({
    displayName: greetingName,
    previousGreetingId,
  });
  const eventId = homeSessionGreetingEventId(twinId, greeting.id);

  attemptedTwinIds.add(twinId);
  markHomeSessionGreetingAttempted({
    twinId,
    greetingId: greeting.id,
  });

  return {
    type: "speech.requested",
    eventId,
    dedupeKey: eventId,
    text: greeting.text,
    voiceStyle: "energetic",
    failureMode: "quiet",
  };
}

function isGreetingAllowedVoicePhase(phase: HomepageVoicePhase | null): boolean {
  return phase === null || phase === "idle" || phase === "armed_wake";
}
