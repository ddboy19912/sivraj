import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { OnboardingStepViewProps } from "@/types/onboarding.types";
import { StepHeading } from "@/pages/onboarding/ui/StepHeading";

export function IntroStep({ flow }: OnboardingStepViewProps) {
  return (
    <div className="grid gap-5 py-1">
      <StepHeading
        eyebrow="Sivraj"
        title="A private AI Twin for the life you are building."
        body="Sivraj helps your memory compound over time. You choose what it learns, your private context stays encrypted, and your Twin grows from the name, voice, and first memory you give it."
      />
      <Button
        className="w-max px-8"
        variant="primary"
        type="button"
        onClick={flow.beginOnboarding}
      >
        <Sparkles className="size-4" />
        Begin Journey
      </Button>
    </div>
  );
}
