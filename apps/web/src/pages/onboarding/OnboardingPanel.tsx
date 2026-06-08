import { liquidGlass } from "@/lib/ui/liquid-glass";
import { cn } from "@/lib/ui/utils";
import type { OnboardingFlow } from "@/types/onboarding.types";
import {
  onboardingStepViews,
  shouldShowOnboardingTimeline,
} from "@/lib/onboarding/step-views";
import { OnboardingTimeline } from "@/pages/onboarding/OnboardingTimeline";

type OnboardingPanelProps = {
  flow: OnboardingFlow;
};

export function OnboardingPanel({ flow }: OnboardingPanelProps) {
  if (flow.accessState.status !== "onboarding" || !flow.currentStep) {
    return null;
  }

  const Step = onboardingStepViews[flow.currentStep];

  return (
    <section
      className={cn(
        liquidGlass,
        "absolute inset-x-4 top-[8svh] z-20 mx-auto w-[min(820px,calc(100vw-32px))] rounded-[28px] p-5 text-left max-[760px]:top-[7svh]",
      )}
      aria-label="Twin onboarding"
    >
      <div className="relative z-1 grid gap-5">
        {shouldShowOnboardingTimeline(flow.currentStep) ? (
          <OnboardingTimeline flow={flow} />
        ) : null}
        <div className="min-w-0">
          <Step flow={flow} />
        </div>
      </div>

      {flow.error ? (
        <p className="mt-4 rounded-2xl border border-red-300/20 bg-red-500/10 px-4 py-3 text-sm text-red-100">
          {flow.error}
        </p>
      ) : null}
    </section>
  );
}
