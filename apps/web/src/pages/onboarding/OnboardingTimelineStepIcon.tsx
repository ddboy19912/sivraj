import { Check, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/ui/utils";
import type { TimelineStepVisualState } from "@/pages/onboarding/onboarding-timeline-state";

type OnboardingTimelineStepIconProps = {
  Icon: LucideIcon;
  visualState: TimelineStepVisualState;
};

export function OnboardingTimelineStepIcon({
  Icon,
  visualState,
}: OnboardingTimelineStepIconProps) {
  const { isActive, isComplete, isUnlocked } = visualState;

  return (
    <span
      className={cn(
        "relative grid size-11 place-items-center rounded-full border transition duration-200 max-[620px]:size-9",
        isActive
          ? "border-[rgba(var(--theme-color-rgb),0.72)] bg-[#071112] text-white shadow-[0_0_28px_rgba(var(--theme-color-rgb),0.28),inset_0_0_28px_rgba(var(--theme-color-rgb),0.2),inset_0_1px_0_rgba(255,255,255,0.2)]"
          : isComplete
            ? "border-[rgba(var(--theme-color-rgb),0.34)] bg-[#071112] text-[rgb(var(--theme-color-rgb))] shadow-[inset_0_0_22px_rgba(var(--theme-color-rgb),0.14)]"
            : isUnlocked
              ? "border-white/14 bg-[#050809] text-white/62 group-hover:border-[rgba(var(--theme-color-rgb),0.34)] group-hover:bg-[#071112]"
              : "border-white/8 bg-[#050809] text-white/22",
      )}
    >
      {isActive ? (
        <span
          className="absolute inset-1 rounded-full border border-[rgba(var(--theme-color-rgb),0.22)]"
          aria-hidden="true"
        />
      ) : null}
      {isComplete ? (
        <span
          className="absolute -right-0.5 -top-0.5 grid size-4 place-items-center rounded-full border border-[rgba(var(--theme-color-rgb),0.32)] bg-[rgb(var(--theme-color-rgb))] text-black"
          aria-hidden="true"
        >
          <Check className="size-2.5" />
        </span>
      ) : null}
      <Icon
        className={cn(
          "relative z-10 size-4 transition max-[620px]:size-3.5",
          isActive ? "scale-110" : undefined,
        )}
      />
    </span>
  );
}
