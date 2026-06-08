import { Loader2, Mic, RotateCcw, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { OnboardingStepViewProps } from "@/types/onboarding.types";

function formatRecordingDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

function canClearVoiceRecording(recorderState: string) {
  return recorderState !== "recording" && recorderState !== "saving";
}

function cloneRecordButtonLabel(recorderState: string) {
  return recorderState === "requesting" ? "Requesting..." : "Record";
}

function canContinueCloneVoice(input: {
  isBusy: boolean;
  recordedBlob: Blob | null;
  cloneConsent: boolean;
  recorderState: string;
}) {
  return !input.isBusy &&
    Boolean(input.recordedBlob) &&
    input.cloneConsent &&
    input.recorderState !== "saving";
}

export function CloneVoiceDetails({ flow }: OnboardingStepViewProps) {
  return (
    <div className="grid gap-4 rounded-3xl p-4">
      <CloneVoiceRecorderControls flow={flow} />
      {flow.recordingPreviewUrl ? (
        <audio
          aria-label="Voice recording preview"
          className="h-10 w-full"
          src={flow.recordingPreviewUrl}
          controls
        >
          <track
            kind="captions"
            src="data:text/vtt,WEBVTT%0A"
            srcLang="en"
            label="No captions available"
          />
        </audio>
      ) : null}
      <CloneVoiceConsentCheckbox flow={flow} />
      <CloneVoiceContinueButton flow={flow} />
    </div>
  );
}

function CloneVoiceRecorderControls({ flow }: OnboardingStepViewProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {flow.recorderState === "recording" ? (
        <Button size="lg" type="button" onClick={flow.stopVoiceCloneRecording}>
          <Square className="size-4" />
          Stop
        </Button>
      ) : (
        <Button
          size="lg"
          type="button"
          onClick={flow.startVoiceCloneRecording}
          disabled={
            flow.isBusy ||
            flow.recorderState === "requesting" ||
            flow.recorderState === "saving"
          }
        >
          {flow.recorderState === "requesting" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Mic className="size-4" />
          )}
          {cloneRecordButtonLabel(flow.recorderState)}
        </Button>
      )}
      <Button
        size="icon-lg"
        type="button"
        aria-label="Clear voice recording"
        title="Clear voice recording"
        onClick={flow.clearVoiceCloneRecording}
        disabled={!canClearVoiceRecording(flow.recorderState)}
      >
        <RotateCcw className="size-4" />
      </Button>
      <span className="font-mono text-xs text-white/52">
        {formatRecordingDuration(flow.recordingSeconds)}
      </span>
    </div>
  );
}

function CloneVoiceConsentCheckbox({ flow }: OnboardingStepViewProps) {
  return (
    <label className="flex items-start gap-2 text-sm leading-5 text-white/62">
      <input
        className="mt-1"
        type="checkbox"
        checked={flow.cloneConsent}
        onChange={(event) => flow.setCloneConsent(event.target.checked)}
      />
      <span>
        I am recording my own voice and consent to Sivraj using it as my
        private assistant voice.
      </span>
    </label>
  );
}

function CloneVoiceContinueButton({ flow }: OnboardingStepViewProps) {
  return (
    <Button
      variant="secondary"
      type="button"
      onClick={flow.chooseClonedVoiceArrival}
      disabled={!canContinueCloneVoice({
        isBusy: flow.isBusy,
        recordedBlob: flow.recordedBlob,
        cloneConsent: flow.cloneConsent,
        recorderState: flow.recorderState,
      })}
    >
      {flow.recorderState === "saving" ? "Saving..." : "Continue"}
      {flow.recorderState === "saving" ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <Mic className="size-4" />
      )}
    </Button>
  );
}
