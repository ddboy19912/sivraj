import { TelegramIntegrationCard } from "@/components/integrations/TelegramIntegrationCard";
import { useAppRouteContext } from "@/providers/app-route-context";

export default function IntegrationsRoute() {
  const { onboarding } = useAppRouteContext();

  if (!onboarding.canUseProtectedApp || !onboarding.session) {
    return null;
  }

  return (
    <div className="relative z-10 h-svh overflow-y-auto px-4 pb-[calc(112px+env(safe-area-inset-bottom))] pt-24 sm:px-6 lg:px-10">
      <section className="mx-auto w-full max-w-6xl text-[#f7fdff]">
        <header className="pb-10">
          <h1 className="mt-4 text-3xl font-semibold text-[#f7fdff]">
            Integrations
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-white/48">
            Connect external surfaces that can send memory into your Twin.
          </p>
        </header>

        <section className="grid gap-5 border-t border-white/10 py-8 lg:grid-cols-[260px_minmax(0,1fr)]">
          <h2 className="pt-1 text-[11px] font-bold tracking-[0.12em] text-white/44 uppercase">
            Messaging
          </h2>
          <div className="min-w-0">
            <TelegramIntegrationCard
              session={onboarding.session}
              onSessionRefreshed={onboarding.setSession}
            />
          </div>
        </section>
      </section>
    </div>
  );
}
