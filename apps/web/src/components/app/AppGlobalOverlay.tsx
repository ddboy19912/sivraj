import type { AppOverlay } from "@/lib/app/overlay";
import { liquidGlass } from "@/lib/ui/liquid-glass";
import { cn } from "@/lib/ui/utils";
import { OnboardingPanel } from "@/pages/onboarding/OnboardingPanel";
import { WalletAuthGate } from "@/pages/onboarding/WalletAuthGate";
import type { OnboardingFlow } from "@/types/onboarding.types";

interface AppGlobalOverlayProps {
  flow: OnboardingFlow;
  overlay: AppOverlay;
}

export function AppGlobalOverlay({ flow, overlay }: AppGlobalOverlayProps) {
  if (overlay === "pending") {
    return <AppPendingOverlay flow={flow} />;
  }

  if (overlay === "wallet_auth") {
    return <WalletAuthGate flow={flow} />;
  }

  if (overlay === "onboarding") {
    return <OnboardingPanel flow={flow} />;
  }

  return null;
}

function AppPendingOverlay({ flow }: { flow: OnboardingFlow }) {
  const title =
    flow.accessState.status === "pending" ||
    flow.accessState.status === "fatal_error"
      ? flow.accessState.title
      : "Initializing Twin";
  const message =
    flow.accessState.status === "pending"
      ? flow.accessState.message
      : flow.accessState.status === "fatal_error"
        ? flow.accessState.message
        : null;

  return (
    <section
      className={cn(
        liquidGlass,
        "absolute inset-x-4 top-[8svh] z-20 mx-auto w-[min(560px,calc(100vw-32px))] rounded-[28px] p-5 text-left max-[760px]:top-[7svh]",
      )}
      aria-label="App loading"
      aria-busy="true"
    >
      <div className="grid gap-4">
        <div className="grid gap-2">
          <p className="font-mono text-xs font-bold uppercase tracking-[1.6px] text-[rgb(var(--theme-color-rgb))]">
            Sivraj
          </p>
          <h2 className="text-2xl font-semibold tracking-normal text-white">
            {title}
          </h2>
          {message ? (
            <p className="text-sm leading-6 text-white/62">{message}</p>
          ) : null}
        </div>
        <div className="grid gap-2">
          <div className="h-3 w-4/5 overflow-hidden rounded-full bg-white/10">
            <div className="h-full w-1/2 animate-pulse rounded-full bg-[rgba(var(--theme-color-rgb),0.55)]" />
          </div>
          <div className="h-3 w-2/3 rounded-full bg-white/8" />
        </div>
        {flow.accessState.status === "fatal_error" ? (
          <button
            type="button"
            onClick={flow.accessState.retry}
            className="w-fit rounded-full border border-white/14 px-4 py-2 text-sm font-semibold text-white transition hover:border-[rgba(var(--theme-color-rgb),0.45)] hover:bg-white/8"
          >
            Retry
          </button>
        ) : null}
      </div>
    </section>
  );
}
