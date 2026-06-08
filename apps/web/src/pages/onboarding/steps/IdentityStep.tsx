import { Brain, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { OnboardingStepViewProps } from "@/types/onboarding.types";
import { StepHeading } from "@/pages/onboarding/ui/StepHeading";

const fieldLabelClassName =
  "font-mono text-xs font-semibold uppercase tracking-widest text-[rgba(var(--theme-color-rgb),0.86)]";

export function IdentityStep({ flow }: OnboardingStepViewProps) {
  const saveLabel = saveStageLabel(flow.saveStage, flow.twinName);

  return (
    <div className="grid gap-5">
      <StepHeading
        eyebrow="First memory"
        title={`Give ${flow.twinName} its first memory.`}
        body="Tell your Twin what to call you, the other names connected to you, and one thing worth remembering."
      />
      <div className="grid grid-cols-2 gap-3 max-[560px]:grid-cols-1">
        <label className="grid gap-2" htmlFor="identity-display-name">
          <span className={fieldLabelClassName}>What should I call you?</span>
          <Input
            id="identity-display-name"
            value={flow.displayName}
            onChange={(event) => flow.setDisplayName(event.target.value)}
            placeholder="John"
          />
        </label>
        <label className="grid gap-2" htmlFor="identity-aliases">
          <span className={fieldLabelClassName}>Other names and aliases</span>
          <Input
            id="identity-aliases"
            value={flow.alias}
            onChange={(event) => flow.setAlias(event.target.value)}
            placeholder="John Doe, Johnny, @johndoe"
          />
        </label>
      </div>
      <label className="grid gap-2" htmlFor="identity-first-memory">
        <span className={fieldLabelClassName}>
          What should I know about you first?
        </span>
        <textarea
          id="identity-first-memory"
          className="min-h-32 w-full resize-none rounded-2xl border border-white/14 bg-[#101416] px-4 py-3 text-base leading-6 text-white outline-none transition placeholder:text-white/28 focus:border-[rgba(var(--theme-color-rgb),0.52)] focus:ring-4 focus:ring-[rgba(var(--theme-color-rgb),0.12)]"
          value={flow.firstMemory}
          onChange={(event) => flow.setFirstMemory(event.target.value)}
          placeholder="Tell your Twin what you are building, what matters, or how you like to work."
        />
      </label>
      <Button
        variant="primary"
        type="button"
        disabled={
          flow.isBusy || !flow.displayName.trim() || !flow.firstMemory.trim()
        }
        onClick={flow.saveIdentitySeed}
      >
        {flow.isBusy ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Brain className="size-4" />
        )}
        {flow.isBusy ? saveLabel : `Save memory and meet ${flow.twinName}`}
      </Button>
    </div>
  );
}

function saveStageLabel(saveStage: string, twinName: string) {
  if (saveStage === "encrypting") {
    return "Encrypting memory...";
  }

  if (saveStage === "storing_memory") {
    return "Storing memory...";
  }

  if (saveStage === "finishing_profile") {
    return "Finishing profile...";
  }

  if (saveStage === "complete") {
    return `Meeting ${twinName}...`;
  }

  return "Saving memory...";
}
