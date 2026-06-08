import { Homepage } from "@/pages/Homepage";
import { useAppRouteContext } from "@/providers/app-route-context";

export default function HomeRoute() {
  const { homeAgentState, homeStatusHud, onboarding } = useAppRouteContext();

  return (
    <Homepage
      agentState={homeAgentState}
      statusHud={onboarding.canUseProtectedApp ? homeStatusHud : null}
    />
  );
}
