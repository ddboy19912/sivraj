import { useState } from "react";
import { ArrivalVoicePathPicker } from "@/pages/onboarding/steps/ArrivalVoicePathPicker";
import { CloneVoiceDetails } from "@/pages/onboarding/steps/CloneVoiceDetails";
import { PresetVoiceDetails } from "@/pages/onboarding/steps/PresetVoiceDetails";
import { StepHeading } from "@/pages/onboarding/ui/StepHeading";
import type { OnboardingStepViewProps } from "@/types/onboarding.types";

type VoicePath = "preset" | "clone";

export function ArrivalStep({ flow }: OnboardingStepViewProps) {
  const [voicePath, setVoicePath] = useState<VoicePath | null>(null);

  return (
    <div className="grid gap-5">
      <StepHeading
        eyebrow="Voice"
        title={`Choose ${flow.twinName}'s voice`}
        body="Use a preset voice now, or create a private voice clone with consent."
      />
      <ArrivalVoicePathPicker
        voicePath={voicePath}
        isBusy={flow.isBusy}
        onSelectPath={setVoicePath}
      />
      {voicePath === "preset" ? <PresetVoiceDetails flow={flow} /> : null}
      {voicePath === "clone" ? <CloneVoiceDetails flow={flow} /> : null}
    </div>
  );
}
