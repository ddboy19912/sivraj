import {
  Brain,
  Sparkles,
  Wallet,
  Volume2,
  type LucideIcon,
} from "lucide-react";

import type {
  ActiveOnboardingStep,
  OnboardingFlow,
} from "@/types/onboarding.types";
import {
  getOnboardingTimelineProgress,
  getTimelineStepVisualState,
} from "@/pages/onboarding/onboarding-timeline-state";
import { OnboardingTimelineStep } from "@/pages/onboarding/OnboardingTimelineStep";

type OnboardingTimelineProps = {
  flow: OnboardingFlow;
};

const timelineSteps: Array<{
  id: ActiveOnboardingStep;
  label: string;
  Icon: LucideIcon;
}> = [
  { id: "connect", label: "Wallet", Icon: Wallet },
  { id: "name", label: "Name", Icon: Sparkles },
  { id: "arrival", label: "Voice", Icon: Volume2 },
  { id: "identity", label: "Memory", Icon: Brain },
];

export function OnboardingTimeline({ flow }: OnboardingTimelineProps) {
  const activeIndex = Math.max(
    timelineSteps.findIndex(({ id }) => id === flow.currentStep),
    0,
  );
  const progress = getOnboardingTimelineProgress(activeIndex, timelineSteps.length);

  return (
    <nav className="relative" aria-label="Onboarding progress">
      <div
        className="pointer-events-none absolute left-[calc(12.5%+20px)] right-[calc(12.5%+20px)] top-[22px] h-px bg-white/10 max-[620px]:left-[calc(12.5%+17px)] max-[620px]:right-[calc(12.5%+17px)]"
        aria-hidden="true"
      >
        <div
          className="h-full rounded-full bg-[rgb(var(--theme-color-rgb))] shadow-[0_0_18px_rgba(var(--theme-color-rgb),0.42)] transition-[width] duration-500 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>
      <ol className="relative z-10 grid grid-cols-4 gap-2 max-[620px]:gap-1">
        {timelineSteps.map(({ id, label, Icon }, index) => (
          <OnboardingTimelineStep
            key={id}
            id={id}
            label={label}
            index={index}
            Icon={Icon}
            visualState={getTimelineStepVisualState({
              index,
              activeIndex,
              currentStepId: flow.currentStep,
              stepId: id,
              unlockedStepIndex: flow.unlockedStepIndex,
            })}
            onSelect={() => flow.goToStep(id)}
          />
        ))}
      </ol>
    </nav>
  );
}
