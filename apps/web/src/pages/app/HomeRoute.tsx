import { Homepage } from "@/pages/Homepage";
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

  return (
    <Homepage
      statusHud={onboarding.canUseProtectedApp ? homeStatusHud : null}
      voiceChat={onboarding.canUseProtectedApp ? voiceChat : null}
      twinName={onboarding.twinName}
    />
  );
}
