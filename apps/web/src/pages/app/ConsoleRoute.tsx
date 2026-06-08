import { ConsoleShell } from "@/console/ConsoleShell";
import { useAppRouteContext } from "@/providers/app-route-context";

export default function ConsoleRoute() {
  const { onboarding } = useAppRouteContext();

  if (!onboarding.canUseProtectedApp) {
    return null;
  }

  return (
    <div className="absolute inset-x-4 top-[84px] bottom-[104px] z-10 mx-auto max-w-[1180px] overflow-y-auto rounded-[28px]">
      <ConsoleShell
        session={onboarding.session}
        isSessionForWallet={onboarding.canUseProtectedApp}
        onSessionRefreshed={onboarding.setSession}
      />
    </div>
  );
}
