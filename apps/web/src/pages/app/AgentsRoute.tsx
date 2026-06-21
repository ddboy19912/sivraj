import { AgentsSettingsSection } from "@/components/settings/AgentsSettingsSection";
import { useAppRouteContext } from "@/providers/app-route-context";

export default function AgentsRoute() {
  const { onboarding } = useAppRouteContext();

  if (!onboarding.canUseProtectedApp || !onboarding.session) {
    return null;
  }

  return (
    <div className="agents-route-page relative z-10 h-svh overflow-y-auto px-4 pb-[calc(112px+env(safe-area-inset-bottom))] pt-24 sm:px-6 lg:px-10">
      <div className="mx-auto w-full max-w-6xl">
        <AgentsSettingsSection
          session={onboarding.session}
          onSessionRefreshed={onboarding.setSession}
        />
      </div>
    </div>
  );
}
