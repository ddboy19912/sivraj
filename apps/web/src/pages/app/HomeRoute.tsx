import { Homepage } from "@/pages/Homepage";
import { useAppRouteContext } from "@/providers/app-route-context";

export default function HomeRoute() {
  const { homeStatusHud, onboarding } = useAppRouteContext();

  return (
    <Homepage
      statusHud={onboarding.canUseProtectedApp ? homeStatusHud : null}
    />
  );
}
