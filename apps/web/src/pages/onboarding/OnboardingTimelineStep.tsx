import { type LucideIcon } from "lucide-react";
import { OnboardingTimelineStepIcon } from "@/pages/onboarding/OnboardingTimelineStepIcon";
import { cn } from "@/lib/ui/utils";
import type { TimelineStepVisualState } from "@/pages/onboarding/onboarding-timeline-state";

type OnboardingTimelineStepProps = {
  id: string;
  label: string;
  index: number;
  Icon: LucideIcon;
  visualState: TimelineStepVisualState;
  onSelect(): void;
};

export function OnboardingTimelineStep({
  label,
  index,
  Icon,
  visualState,
  onSelect,
}: OnboardingTimelineStepProps) {
  const { isActive, isUnlocked } = visualState;

  return (
    <li className="min-w-0">
      <button
        className={cn(
          "group grid w-full justify-items-center gap-1.5 text-center text-[11px] font-semibold transition duration-200",
          isUnlocked
            ? "text-white/58 hover:-translate-y-0.5 hover:text-white"
            : "cursor-not-allowed text-white/24",
        )}
        type="button"
        disabled={!isUnlocked}
        onClick={onSelect}
        aria-current={isActive ? "step" : undefined}
        aria-label={`Step ${index + 1}: ${label}`}
      >
        <OnboardingTimelineStepIcon Icon={Icon} visualState={visualState} />
        <span
          className={cn(
            "truncate",
            isActive ? "text-white" : undefined,
            !isUnlocked ? "max-[620px]:hidden" : undefined,
          )}
        >
          {label}
        </span>
      </button>
    </li>
  );
}
