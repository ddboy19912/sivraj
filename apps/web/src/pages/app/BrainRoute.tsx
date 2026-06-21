import { BrainPage } from "@/components/brain/BrainPage";
import { useAppRouteContext } from "@/providers/app-route-context";

export default function BrainRoute() {
  const { onboarding } = useAppRouteContext();

  if (!onboarding.canUseProtectedApp || !onboarding.session) {
    return null;
  }

  return (
    <BrainPage
      session={onboarding.session}
      twinName={onboarding.twinName}
      onSessionRefreshed={onboarding.setSession}
    />
  );
}
