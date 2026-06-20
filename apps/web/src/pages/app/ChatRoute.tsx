import { ChatPage } from "@/components/chat/ChatPage";
import { useAppRouteContext } from "@/providers/app-route-context";

export default function ChatRoute() {
  const { onboarding, providerState, setProviderState } =
    useAppRouteContext();

  if (!onboarding.canUseProtectedApp) {
    return null;
  }

  return (
    <ChatPage
      session={onboarding.session}
      isSessionForWallet={onboarding.canUseProtectedApp}
      twinName={onboarding.twinName}
      onSessionRefreshed={onboarding.setSession}
      providerState={providerState}
      onProviderStateChange={setProviderState}
    />
  );
}
