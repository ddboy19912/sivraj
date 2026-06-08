import { Mic, Volume2 } from "lucide-react";
import { liquidGlassDense } from "@/lib/ui/liquid-glass";
import { cn } from "@/lib/ui/utils";

type VoicePath = "preset" | "clone";

type ArrivalVoicePathPickerProps = {
  voicePath: VoicePath | null;
  isBusy: boolean;
  onSelectPath: (path: VoicePath) => void;
};

export function ArrivalVoicePathPicker({
  voicePath,
  isBusy,
  onSelectPath,
}: ArrivalVoicePathPickerProps) {
  return (
    <div className="grid grid-cols-2 gap-3 max-[560px]:grid-cols-1">
      <VoicePathCard
        path="preset"
        selectedPath={voicePath}
        isBusy={isBusy}
        icon={Volume2}
        title="Preset voice"
        description="Pick from Sivraj's ready-made voices."
        onSelect={onSelectPath}
      />
      <VoicePathCard
        path="clone"
        selectedPath={voicePath}
        isBusy={isBusy}
        icon={Mic}
        title="Clone my voice"
        description="Create a private voice from your own sample."
        onSelect={onSelectPath}
      />
    </div>
  );
}

function VoicePathCard({
  path,
  selectedPath,
  isBusy,
  icon: Icon,
  title,
  description,
  onSelect,
}: {
  path: VoicePath;
  selectedPath: VoicePath | null;
  isBusy: boolean;
  icon: typeof Volume2;
  title: string;
  description: string;
  onSelect: (path: VoicePath) => void;
}) {
  return (
    <button
      className={cn(
        liquidGlassDense,
        "grid min-h-32 gap-3 overflow-hidden rounded-3xl p-4 text-left transition hover:border-[rgba(var(--theme-color-rgb),0.4)] disabled:cursor-not-allowed disabled:opacity-50",
        selectedPath === path && "border-[rgba(var(--theme-color-rgb),0.52)]",
      )}
      type="button"
      disabled={isBusy}
      onClick={() => onSelect(path)}
    >
      <span className="grid size-9 place-items-center rounded-full bg-[rgba(var(--theme-color-rgb),0.18)] text-[rgb(var(--theme-color-rgb))]">
        <Icon className="size-5" />
      </span>
      <span className="grid gap-1">
        <h3 className="font-sora font-medium text-xl text-white">{title}</h3>
        <span className="text-sm leading-5 text-white/58">{description}</span>
      </span>
    </button>
  );
}
