import { useEffect, useReducer, useRef } from "react";
import { Mic2, Radio, RotateCcw, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  loadProviderConfig,
  type ProviderConfigResponse,
} from "@/lib/chat/chat-api";
import { errorMessage } from "@/lib/api";
import type { Session } from "@/lib/session";
import {
  loadVoicePresets,
  loadVoiceProfile,
  loadVoiceSettings,
  updatePresetVoiceProfile,
  updateVoiceSettings,
} from "@/lib/voice/voice-api";
import { cn } from "@/lib/ui/utils";
import type {
  TwinVoiceProfile,
  VoicePreset,
  VoiceSettings,
} from "@/types/voice.types";

type VoiceSettingsSectionProps = {
  session: Session | null;
  providerState: ProviderConfigResponse | null;
  onProviderStateChange: (state: ProviderConfigResponse | null) => void;
  onSessionRefreshed: (session: Session) => void;
};

type VoiceSettingsViewStatus = "idle" | "loading" | "saving" | "failed";

type VoiceSettingsViewState = {
  settings: VoiceSettings | null;
  profile: TwinVoiceProfile | null;
  voicePresets: VoicePreset[];
  selectedVoiceId: string;
  loadedTwinId: string | null;
  wakePhraseInput: string;
  status: VoiceSettingsViewStatus;
  notice: string | null;
};

type VoiceSettingsViewAction =
  | {
      type: "LOAD_SUCCEEDED";
      twinId: string;
      settings: VoiceSettings;
      profile: TwinVoiceProfile | null;
      presets: VoicePreset[];
      defaultVoiceId: string;
    }
  | { type: "LOAD_FAILED"; error: string }
  | { type: "SAVING" }
  | { type: "SELECT_VOICE"; voiceId: string }
  | { type: "VOICE_SAVED"; profile: TwinVoiceProfile }
  | { type: "WAKE_PHRASE_CHANGED"; value: string }
  | { type: "WAKE_SETTINGS_SAVED"; settings: VoiceSettings }
  | { type: "SAVE_FAILED"; error: string };

const initialVoiceSettingsViewState: VoiceSettingsViewState = {
  settings: null,
  profile: null,
  voicePresets: [],
  selectedVoiceId: "",
  loadedTwinId: null,
  wakePhraseInput: "",
  status: "idle",
  notice: null,
};

function voiceSettingsViewReducer(
  state: VoiceSettingsViewState,
  action: VoiceSettingsViewAction,
): VoiceSettingsViewState {
  switch (action.type) {
    case "LOAD_SUCCEEDED":
      return {
        ...state,
        settings: action.settings,
        profile: action.profile,
        voicePresets: action.presets,
        selectedVoiceId:
          action.profile?.mode === "preset"
            ? action.profile.presetVoiceId
            : action.defaultVoiceId,
        loadedTwinId: action.twinId,
        wakePhraseInput: action.settings.wakePhrase,
        status: "idle",
        notice: null,
      };
    case "LOAD_FAILED":
      return { ...state, status: "failed", notice: action.error };
    case "SAVING":
      return { ...state, status: "saving", notice: null };
    case "SELECT_VOICE":
      return { ...state, selectedVoiceId: action.voiceId };
    case "VOICE_SAVED":
      return {
        ...state,
        profile: action.profile,
        selectedVoiceId: action.profile.presetVoiceId,
        status: "idle",
      };
    case "WAKE_PHRASE_CHANGED":
      return { ...state, wakePhraseInput: action.value };
    case "WAKE_SETTINGS_SAVED":
      return {
        ...state,
        settings: action.settings,
        wakePhraseInput: action.settings.wakePhrase,
        status: "idle",
      };
    case "SAVE_FAILED":
      return { ...state, status: "failed", notice: action.error };
  }
}

export function VoiceSettingsSection({
  session,
  providerState,
  onProviderStateChange,
  onSessionRefreshed,
}: VoiceSettingsSectionProps) {
  const [viewState, dispatchView] = useReducer(
    voiceSettingsViewReducer,
    initialVoiceSettingsViewState,
  );
  const {
    settings,
    profile,
    voicePresets,
    selectedVoiceId,
    loadedTwinId,
    wakePhraseInput,
    status,
    notice,
  } = viewState;
  const wakeSupported = isWakePhraseSupported();
  const speechToText = providerState?.runtimeDefaults?.speech_to_text;
  const textToSpeech = providerState?.runtimeDefaults?.text_to_speech;
  const sessionRef = useRef(session);
  const providerStateRef = useRef(providerState);
  const onProviderStateChangeRef = useRef(onProviderStateChange);
  const onSessionRefreshedRef = useRef(onSessionRefreshed);

  useEffect(() => {
    sessionRef.current = session;
    providerStateRef.current = providerState;
    onProviderStateChangeRef.current = onProviderStateChange;
    onSessionRefreshedRef.current = onSessionRefreshed;
  }, [onProviderStateChange, onSessionRefreshed, providerState, session]);

  useEffect(() => {
    const activeSession = sessionRef.current;
    if (!activeSession) {
      return;
    }

    let cancelled = false;

    void Promise.all([
      loadVoicePresets(activeSession, onSessionRefreshedRef.current),
      loadVoiceSettings(activeSession, onSessionRefreshedRef.current),
      loadVoiceProfile(activeSession, onSessionRefreshedRef.current).catch(() => null),
      providerStateRef.current
        ? Promise.resolve(providerStateRef.current)
        : loadProviderConfig(activeSession, onSessionRefreshedRef.current),
    ])
      .then(
        ([
          nextPresetResponse,
          nextSettings,
          nextProfile,
          nextProviderState,
        ]) => {
          if (cancelled) {
            return;
          }

          dispatchView({
            type: "LOAD_SUCCEEDED",
            twinId: activeSession.twinId,
            settings: nextSettings,
            profile: nextProfile,
            presets: nextPresetResponse.presets,
            defaultVoiceId: nextPresetResponse.defaultVoiceId,
          });
          onProviderStateChangeRef.current(nextProviderState);
        },
      )
      .catch((error: unknown) => {
        if (!cancelled) {
          dispatchView({ type: "LOAD_FAILED", error: errorMessage(error) });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [session?.twinId]);

  async function savePresetVoice() {
    if (!session || !selectedVoiceId) {
      return;
    }

    dispatchView({ type: "SAVING" });
    try {
      const nextProfile = await updatePresetVoiceProfile(
        { presetVoiceId: selectedVoiceId },
        session,
        onSessionRefreshed,
      );
      dispatchView({ type: "VOICE_SAVED", profile: nextProfile });
    } catch (error) {
      dispatchView({ type: "SAVE_FAILED", error: errorMessage(error) });
    }
  }

  async function saveWakeSettings(input: {
    wakeEnabled?: boolean;
    wakePhrase?: string | null;
  }) {
    if (!session) {
      return;
    }

    dispatchView({ type: "SAVING" });
    try {
      const nextSettings = await updateVoiceSettings(
        {
          ...input,
          clientWakeSupported: wakeSupported,
        },
        session,
        onSessionRefreshed,
      );
      dispatchView({ type: "WAKE_SETTINGS_SAVED", settings: nextSettings });
    } catch (error) {
      dispatchView({ type: "SAVE_FAILED", error: errorMessage(error) });
    }
  }

  if (!session) {
    return null;
  }

  const currentPresetVoiceId =
    profile?.mode === "preset" ? profile.presetVoiceId : null;
  const viewStatus = session.twinId === loadedTwinId ? status : "loading";
  const isBusy = viewStatus === "loading" || viewStatus === "saving";
  const canApplyPresetVoice =
    Boolean(selectedVoiceId) &&
    !isBusy &&
    selectedVoiceId !== currentPresetVoiceId;
  const trimmedWakePhrase = wakePhraseInput.trim();
  const wakeEnabled = settings?.wakeEnabled ?? false;
  const canApplyWakePhrase =
    !isBusy &&
    trimmedWakePhrase.length > 0 &&
    settings != null &&
    trimmedWakePhrase !== settings.wakePhrase;

  return (
    <section className="grid gap-6">
      <header className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold tracking-[0.08em] text-[rgba(231,252,255,0.48)] uppercase">
          Voice
        </p>
        <span
          className={cn(
            "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-medium",
            textToSpeech?.configured
              ? "border-emerald-300/22 bg-emerald-300/8 text-emerald-100/86"
              : "border-amber-300/22 bg-amber-300/8 text-amber-100/86",
          )}
        >
          <Volume2 className="size-3.5" />
          {textToSpeech?.configured ? "TTS ready" : "TTS missing"}
        </span>
      </header>

      <div className="grid gap-2.5">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-sm font-medium text-white">Assistant voice</p>
          {canApplyPresetVoice ? (
            <span className="text-xs font-medium text-[rgb(var(--theme-color-rgb))]">
              Unsaved change
            </span>
          ) : null}
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2.5">
          <Select
            value={selectedVoiceId}
            onValueChange={(voiceId) =>
              dispatchView({ type: "SELECT_VOICE", voiceId })
            }
            disabled={isBusy || voicePresets.length === 0}
          >
            <SelectTrigger aria-label="Assistant voice">
              <SelectValue placeholder="Choose a voice" />
            </SelectTrigger>
            <SelectContent>
              {voicePresets.map((preset) => (
                <SelectItem key={preset.id} value={preset.id}>
                  {preset.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="secondary"
            disabled={!canApplyPresetVoice}
            onClick={() => void savePresetVoice()}
          >
            Apply
          </Button>
        </div>
        <p className="text-xs text-white/44">Used for every spoken reply.</p>
      </div>

      <dl className="grid gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3.5">
        <StatusRow
          icon={Mic2}
          label="Speech to text"
          value={
            speechToText?.configured
              ? speechToText.displayName
              : "Not configured"
          }
          active={Boolean(speechToText?.configured)}
        />
        <StatusRow
          icon={Radio}
          label="Wake phrase"
          value={wakeSupported ? "Browser supported" : "Push-to-talk fallback"}
          active={wakeSupported}
        />
      </dl>

      <div className="grid gap-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-white">Wake phrase</p>
            <p className="mt-0.5 text-xs text-white/44">
              {wakeEnabled
                ? "Listening for your phrase hands-free."
                : "Turn on to start listening hands-free."}
            </p>
          </div>
          <WakeToggle
            enabled={wakeEnabled}
            disabled={isBusy}
            onToggle={() =>
              void saveWakeSettings({
                wakeEnabled: !wakeEnabled,
                wakePhrase: wakePhraseInput,
              })
            }
          />
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2.5">
          <Input
            value={wakePhraseInput}
            disabled={isBusy}
            placeholder="Hey Jarvis"
            onChange={(event) =>
              dispatchView({
                type: "WAKE_PHRASE_CHANGED",
                value: event.target.value,
              })
            }
            onKeyDown={(event) => {
              if (event.key === "Enter" && canApplyWakePhrase) {
                event.preventDefault();
                void saveWakeSettings({ wakePhrase: wakePhraseInput });
              }
            }}
            aria-label="Wake phrase"
          />
          <Button
            type="button"
            variant="secondary"
            disabled={!canApplyWakePhrase}
            onClick={() =>
              void saveWakeSettings({ wakePhrase: wakePhraseInput })
            }
          >
            Apply
          </Button>
        </div>

        <button
          type="button"
          disabled={isBusy}
          onClick={() => void saveWakeSettings({ wakePhrase: null })}
          className="inline-flex items-center gap-1.5 justify-self-start rounded-md text-xs font-medium text-white/48 transition hover:text-white/76 focus-visible:ring-3 focus-visible:ring-[rgba(var(--theme-color-rgb),0.2)] focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40"
        >
          <RotateCcw className="size-3" />
          Reset to default
        </button>
      </div>

      {notice ? (
        <p className="rounded-2xl border border-red-300/18 bg-red-400/8 px-3 py-2 text-sm text-red-100/86">
          {notice}
        </p>
      ) : null}
    </section>
  );
}

function WakeToggle({
  enabled,
  disabled,
  onToggle,
}: {
  enabled: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label="Toggle wake phrase"
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border transition-colors outline-none focus-visible:ring-3 focus-visible:ring-[rgba(var(--theme-color-rgb),0.2)] disabled:pointer-events-none disabled:opacity-50",
        enabled
          ? "border-[rgba(var(--theme-color-rgb),0.5)] bg-[rgba(var(--theme-color-rgb),0.24)]"
          : "border-white/12 bg-white/[0.06]",
      )}
    >
      <span
        className={cn(
          "pointer-events-none absolute top-1/2 left-0.5 size-5 -translate-y-1/2 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.4)] transition-transform duration-200 ease-out",
          enabled ? "translate-x-5" : "translate-x-0",
        )}
      />
    </button>
  );
}

function StatusRow({
  icon: Icon,
  label,
  value,
  active,
}: {
  icon: typeof Mic2;
  label: string;
  value: string;
  active: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <dt className="flex min-w-0 items-center gap-2 text-white/56">
        <Icon className="size-4 shrink-0" />
        <span className="truncate">{label}</span>
      </dt>
      <dd
        className={cn(
          "truncate text-right",
          active ? "text-white/82" : "text-white/46",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function isWakePhraseSupported() {
  const candidate = globalThis as unknown as {
    SpeechRecognition?: unknown;
    webkitSpeechRecognition?: unknown;
  };
  return Boolean(
    candidate.SpeechRecognition ?? candidate.webkitSpeechRecognition,
  );
}
