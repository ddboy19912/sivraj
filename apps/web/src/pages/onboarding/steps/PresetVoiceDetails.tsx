import { Loader2, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { OnboardingStepViewProps } from "@/types/onboarding.types";

function canPreviewPresetVoice(input: {
  isBusy: boolean;
  selectedVoiceId: string | null;
  previewingVoiceId: string | null;
}) {
  return !input.isBusy && Boolean(input.selectedVoiceId) && input.previewingVoiceId == null;
}

export function PresetVoiceDetails({ flow }: OnboardingStepViewProps) {
  return (
    <div className="grid gap-3 rounded-3xl p-3">
      {flow.voicePresets.length > 0 ? (
        <PresetVoiceSelector flow={flow} />
      ) : (
        <p className="text-sm leading-5 text-white/58">
          Loading preset voices...
        </p>
      )}
      <PresetVoiceContinueButton flow={flow} />
    </div>
  );
}

function PresetVoiceSelector({ flow }: OnboardingStepViewProps) {
  return (
    <div className="grid gap-2">
      <span className="font-mono text-xs font-semibold uppercase tracking-widest text-[rgba(var(--theme-color-rgb),0.86)]">
        Preset voice
      </span>
      <div className="grid grid-cols-[1fr_auto] gap-2 max-[560px]:grid-cols-1">
        <Select
          value={flow.selectedVoiceId}
          onValueChange={flow.setSelectedVoiceId}
          disabled={flow.isBusy || flow.previewingVoiceId != null}
        >
          <SelectTrigger aria-label="Preset voice">
            <SelectValue placeholder="Choose a voice" />
          </SelectTrigger>
          <SelectContent>
            {flow.voicePresets.map((preset) => (
              <SelectItem key={preset.id} value={preset.id}>
                {preset.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          className="max-[560px]:w-full"
          type="button"
          disabled={!canPreviewPresetVoice({
            isBusy: flow.isBusy,
            selectedVoiceId: flow.selectedVoiceId,
            previewingVoiceId: flow.previewingVoiceId,
          })}
          onClick={() => void flow.previewPresetVoice(flow.selectedVoiceId)}
        >
          {flow.previewingVoiceId ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Volume2 className="size-4" />
          )}
          {flow.previewingVoiceId ? "Playing" : "Preview"}
        </Button>
      </div>
    </div>
  );
}

function PresetVoiceContinueButton({ flow }: OnboardingStepViewProps) {
  return (
    <Button
      variant="secondary"
      type="button"
      disabled={flow.isBusy || flow.voicePresets.length === 0}
      onClick={flow.chooseVoiceArrival}
    >
      {flow.isBusy ? "Saving..." : "Continue"}
      {flow.isBusy ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <Volume2 className="size-4" />
      )}
    </Button>
  );
}
