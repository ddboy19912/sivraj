import { PROVIDER_PRESETS } from "@/lib/chat/provider-config-presets";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/ui/utils";
import type { ProviderKind } from "@/lib/chat/chat-api";

export type ProviderConfigFormProps = {
  providerKind: ProviderKind;
  displayName: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  hasSavedApiKey: boolean;
  keyHint: string;
  fallbackLabel: string | null;
  status: string | null;
  onSelectProvider: (kind: ProviderKind) => void;
  onDisplayNameChange: (value: string) => void;
  onBaseUrlChange: (value: string) => void;
  onModelChange: (value: string) => void;
  onApiKeyChange: (value: string) => void;
};

export function ProviderConfigForm({
  providerKind,
  displayName,
  baseUrl,
  model,
  apiKey,
  hasSavedApiKey,
  keyHint,
  fallbackLabel,
  status,
  onSelectProvider,
  onDisplayNameChange,
  onBaseUrlChange,
  onModelChange,
  onApiKeyChange,
}: ProviderConfigFormProps) {
  return (
    <div className="grid gap-5">
      <ProviderKindPicker
        providerKind={providerKind}
        onSelectProvider={onSelectProvider}
      />
      <ProviderFieldGrid
        displayName={displayName}
        baseUrl={baseUrl}
        model={model}
        apiKey={apiKey}
        hasSavedApiKey={hasSavedApiKey}
        keyHint={keyHint}
        onDisplayNameChange={onDisplayNameChange}
        onBaseUrlChange={onBaseUrlChange}
        onModelChange={onModelChange}
        onApiKeyChange={onApiKeyChange}
      />
      <div className="rounded-2xl border border-white/10 bg-white/5 p-3 text-xs leading-5 text-white/52">
        {fallbackLabel ? `Fallback available: ${fallbackLabel}. ` : null}
        Sivraj keeps memory portable when you switch models.
      </div>
      {status ? (
        <div className="rounded-2xl border border-[rgba(var(--theme-color-rgb),0.2)] bg-[rgba(var(--theme-color-rgb),0.08)] p-3 text-sm text-white/76">
          {status}
        </div>
      ) : null}
    </div>
  );
}

function ProviderKindPicker({
  providerKind,
  onSelectProvider,
}: {
  providerKind: ProviderKind;
  onSelectProvider: (kind: ProviderKind) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {(Object.keys(PROVIDER_PRESETS) as ProviderKind[]).map((kind) => (
        <button
          key={kind}
          type="button"
          onClick={() => onSelectProvider(kind)}
          className={cn(
            "rounded-2xl border px-3 py-3 text-left transition",
            providerKind === kind
              ? "border-[rgba(var(--theme-color-rgb),0.54)] bg-[rgba(var(--theme-color-rgb),0.12)] text-white"
              : "border-white/10 bg-white/5 text-white/60 hover:bg-white/8",
          )}
        >
          <span className="block text-sm font-semibold">
            {PROVIDER_PRESETS[kind].label}
          </span>
          <span className="mt-1 block text-[11px] leading-4 text-white/46">
            {PROVIDER_PRESETS[kind].detail}
          </span>
        </button>
      ))}
    </div>
  );
}

function ProviderFieldGrid({
  displayName,
  baseUrl,
  model,
  apiKey,
  hasSavedApiKey,
  keyHint,
  onDisplayNameChange,
  onBaseUrlChange,
  onModelChange,
  onApiKeyChange,
}: {
  displayName: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  hasSavedApiKey: boolean;
  keyHint: string;
  onDisplayNameChange: (value: string) => void;
  onBaseUrlChange: (value: string) => void;
  onModelChange: (value: string) => void;
  onApiKeyChange: (value: string) => void;
}) {
  return (
    <div className="grid gap-3">
      <label className="grid gap-1.5" htmlFor="provider-display-name">
        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-white/46">
          Display name
        </span>
        <Input
          id="provider-display-name"
          value={displayName}
          onChange={(event) => onDisplayNameChange(event.target.value)}
        />
      </label>
      <label className="grid gap-1.5" htmlFor="provider-base-url">
        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-white/46">
          Base URL
        </span>
        <Input
          id="provider-base-url"
          value={baseUrl}
          onChange={(event) => onBaseUrlChange(event.target.value)}
        />
      </label>
      <label className="grid gap-1.5" htmlFor="provider-model">
        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-white/46">
          Model
        </span>
        <Input
          id="provider-model"
          value={model}
          onChange={(event) => onModelChange(event.target.value)}
        />
      </label>
      <label className="grid gap-1.5" htmlFor="provider-api-key">
        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-white/46">
          API key
        </span>
        <Input
          id="provider-api-key"
          type="password"
          value={apiKey}
          placeholder={hasSavedApiKey ? "Saved key configured" : keyHint}
          onChange={(event) => onApiKeyChange(event.target.value)}
        />
        <span className="text-xs text-white/42">{keyHint}</span>
      </label>
    </div>
  );
}
