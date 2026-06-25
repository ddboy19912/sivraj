import { Homepage } from "@/pages/Homepage";
import { useHomeVoiceGreeting } from "@/hooks/twin-runtime/use-home-voice-greeting";
import { useHomepageVoiceChat } from "@/hooks/voice/use-homepage-voice-chat";
import { useAppRouteContext } from "@/providers/app-route-context";

export default function HomeRoute() {
  const { homeStatusHud, onboarding, twinRuntime } = useAppRouteContext();
  const voiceChat = useHomepageVoiceChat({
    session: onboarding.session,
    enabled: onboarding.canUseProtectedApp,
    twinName: onboarding.twinName,
    onSessionRefreshed: onboarding.setSession,
    onRuntimeEvent: twinRuntime.dispatchRuntimeEvent,
  });
  useHomeVoiceGreeting({
    enabled: onboarding.canUseProtectedApp,
    session: onboarding.session,
    displayName: onboarding.displayName,
    firstMeetIntroStatus: onboarding.firstMeetIntroStatus,
    runtimeState: twinRuntime.runtimeState,
    voicePhase: voiceChat.state.phase,
    onRuntimeEvent: twinRuntime.dispatchRuntimeEvent,
  });

  return (
    <Homepage
      statusHud={onboarding.canUseProtectedApp ? homeStatusHud : null}
      runtimeState={twinRuntime.runtimeState}
      voiceChat={onboarding.canUseProtectedApp ? voiceChat : null}
      twinName={onboarding.twinName}
    />
  );
}
