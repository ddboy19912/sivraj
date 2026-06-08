import { ChatPage } from "@/components/chat/ChatPage";
import { useAppRouteContext } from "@/providers/app-route-context";

export default function ChatRoute() {
  const { onboarding, providerState, setProviderOpen, setProviderState } =
    useAppRouteContext();

  if (!onboarding.canUseProtectedApp) {
    return null;
  }

  return (
    <ChatPage
      session={onboarding.session}
      isSessionForWallet={onboarding.canUseProtectedApp}
      onSessionRefreshed={onboarding.setSession}
      onOpenProviderSettings={() => setProviderOpen(true)}
      providerState={providerState}
      onProviderStateChange={setProviderState}
    />
  );
}
