import {
  AgentStatusHud,
  type AgentStatusHudState,
} from "@/components/ai/AgentStatusHud";
import type { useHomepageVoiceChat } from "@/hooks/voice/use-homepage-voice-chat";
import { cn } from "@/lib/ui/utils";
import type { TwinRuntimeState } from "@/types/twin.types";
import type { HomepageVoiceState } from "@/types/voice.types";

type HomepageProps = {
  statusHud?: AgentStatusHudState | null;
  runtimeState?: TwinRuntimeState | null;
  voiceChat?: ReturnType<typeof useHomepageVoiceChat> | null;
  twinName?: string | null;
};

const DEFAULT_TWIN_NAME = "Sivraj";

export function Homepage({
  statusHud,
  runtimeState,
  voiceChat,
  twinName,
}: HomepageProps) {
  const subtitleLines = voiceSubtitleLines(
    voiceChat?.state ?? null,
    runtimeState ?? null,
    twinName?.trim() || DEFAULT_TWIN_NAME,
  );

  return (
    <div>
      {statusHud ? (
        <AgentStatusHud
          label={statusHud.label}
          status={statusHud.status}
          active={statusHud.active}
          progress={statusHud.progress}
          className="home-agent-status-hud absolute right-[10vw] top-[30%] z-3 max-[900px]:right-6 max-[900px]:top-[22%] max-[640px]:right-1/2 max-[640px]:top-[18%] max-[640px]:translate-x-1/2 max-[640px]:scale-90"
        />
      ) : null}

      <VoiceSubtitleOverlay lines={subtitleLines} />
    </div>
  );
}

type VoiceSubtitleLine = {
  id: "user" | "assistant";
  speaker: string;
  text: string;
  active: boolean;
};

function VoiceSubtitleOverlay({ lines }: { lines: VoiceSubtitleLine[] }) {
  if (lines.length === 0) {
    return null;
  }

  return (
    <aside
      aria-label="Voice transcript"
      className="home-voice-subtitles pointer-events-none absolute bottom-[16%] right-[8vw] z-3 flex w-[min(30rem,calc(100vw-3rem))] flex-col items-end gap-2 text-right max-[900px]:bottom-[12%] max-[900px]:right-6 max-[640px]:bottom-8 max-[640px]:right-1/2 max-[640px]:w-[calc(100vw-2rem)] max-[640px]:translate-x-1/2"
    >
      {lines.map((line) => (
        <div
          key={line.id}
          className={cn(
            "home-voice-subtitle-line max-w-full",
            line.id === "user" && "opacity-78",
          )}
        >
          <span className="mb-1 block font-mono text-[0.58rem] font-bold uppercase tracking-[0.16em] text-[rgb(var(--theme-color-rgb))]">
            {line.speaker}
          </span>
          <span
            className={cn(
              "home-voice-subtitle-text block font-sora text-[clamp(0.92rem,1.55vw,1.22rem)] font-semibold leading-snug text-white/78",
              line.active && "text-white",
            )}
          >
            {line.text}
          </span>
        </div>
      ))}
    </aside>
  );
}

function voiceSubtitleLines(
  voiceState: HomepageVoiceState | null,
  runtimeState: TwinRuntimeState | null,
  assistantName: string,
): VoiceSubtitleLine[] {
  if (!voiceState && !runtimeState) {
    return [];
  }

  const userTranscript = latestSubtitle(voiceState?.userTranscript, 72);
  const voiceAssistantTranscript = latestSubtitle(
    voiceState?.partialAssistantTranscript || voiceState?.assistantTranscript,
    118,
  );
  const voiceAssistantLine = voiceAssistantTranscript
    ? {
        id: "assistant" as const,
        speaker: assistantName,
        text: voiceAssistantTranscript,
        active: voiceState?.phase === "thinking" || voiceState?.phase === "speaking",
      }
    : null;
  const runtimeAssistantLine = runtimeSpeechSubtitleLine(runtimeState, assistantName);
  const assistantLine = voiceAssistantLine?.active
    ? voiceAssistantLine
    : runtimeAssistantLine ?? voiceAssistantLine;

  return [
    ...(userTranscript
      ? [{
          id: "user" as const,
          speaker: "You",
          text: userTranscript,
          active: voiceState?.phase === "recording_push_to_talk" || voiceState?.phase === "transcribing",
        }]
      : []),
    ...(assistantLine ? [assistantLine] : []),
  ].slice(-2);
}

function runtimeSpeechSubtitleLine(
  state: TwinRuntimeState | null,
  assistantName: string,
): VoiceSubtitleLine | null {
  if (state?.status !== "speaking") {
    return null;
  }

  const text = latestSubtitle(state.text, 118);
  return text
    ? {
        id: "assistant",
        speaker: assistantName,
        text,
        active: true,
      }
    : null;
}

// Keep the most recent words visible (subtitle behaviour) and signal that
// earlier content scrolled off with a leading ellipsis, instead of clipping
// the head of the message and losing what is currently being said.
function latestSubtitle(
  value: string | null | undefined,
  maxChars: number,
): string | null {
  const normalized = plainSubtitleText(value);
  if (!normalized) {
    return null;
  }

  if (normalized.length <= maxChars) {
    return normalized;
  }

  const tail = normalized.slice(normalized.length - maxChars);
  const firstSpace = tail.indexOf(" ");
  const wordAligned = firstSpace > 0 && firstSpace <= 24
    ? tail.slice(firstSpace + 1)
    : tail;
  return `… ${wordAligned.trimStart()}`;
}

function plainSubtitleText(value: string | null | undefined): string | null {
  const normalized = value
    ?.replace(/```[\s\S]*?```/gu, " ")
    .replace(/`([^`]+)`/gu, "$1")
    .replace(/!\[([^\]]*)\]\([^)]+\)/gu, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/gu, "$1")
    .replace(/(^|\s)#{1,6}\s+/gu, "$1")
    .replace(/(^|\s)>+\s?/gu, "$1")
    .replace(/(^|\s)[*-]\s+/gu, "$1")
    .replace(/[*_~]{1,3}/gu, "")
    .replace(/<[^>]+>/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();

  return normalized || null;
}
