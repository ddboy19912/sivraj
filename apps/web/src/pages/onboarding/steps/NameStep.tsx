import { Bot, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { OnboardingStepViewProps } from "@/types/onboarding.types";
import { StepHeading } from "@/pages/onboarding/ui/StepHeading";

export function NameStep({ flow }: OnboardingStepViewProps) {
  return (
    <div className="grid gap-5">
      <StepHeading
        eyebrow="First breath"
        title="Before your Twin can meet you, give it a name."
        body="This is the name you will see and hear throughout the app."
      />
      <label className="grid gap-2" htmlFor="twin-name">
        <span className="font-mono text-xs font-semibold uppercase tracking-widest text-[rgba(var(--theme-color-rgb),0.86)]">
          Twin name
        </span>
        <Input
          id="twin-name"
          value={flow.twinNameInput}
          onChange={(event) => flow.setTwinNameInput(event.target.value)}
          placeholder="Jarvis"
          autoComplete="off"
        />
      </label>
      <Button
        variant="primary"
        type="button"
        disabled={flow.isBusy || !flow.twinNameInput.trim()}
        onClick={flow.saveTwinName}
      >
        {flow.isBusy ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Bot className="size-4" />
        )}
        {flow.isBusy ? "Naming..." : "Name Twin"}
      </Button>
    </div>
  );
}
