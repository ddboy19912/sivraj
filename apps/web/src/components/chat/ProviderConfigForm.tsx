import { Check, Cloud, Loader2, Trash2 } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { ClipboardActionButton } from "@/components/ui/clipboard-action-button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type {
  RuntimeCapability,
  RuntimeCapabilityConfig,
  SafeProviderConfig,
} from "@/lib/chat/chat-api";
import { cn } from "@/lib/ui/utils";

export type ProviderConfigFormProps = {
  activeProviderConfigId: string | null;
  savedConfigs: SafeProviderConfig[];
  fallbackLabel: string | null;
  runtimeDefaults: Record<string, RuntimeCapabilityConfig> | null;
  isBusy: boolean;
  onConnectOpenRouter: () => void;
  onCreateOpenRouterModel: (input: {
    displayName: string;
    model: string;
    capability: RuntimeCapability;
  }) => Promise<void> | void;
  onSelectDefaultProvider: (capability: RuntimeCapability) => void;
  onSelectSavedProvider: (providerConfigId: string) => void;
  onDeleteSavedProvider: (providerConfigId: string) => void;
  onUpdateProviderModel: (
    providerConfigId: string,
    input: {
      displayName: string;
      model: string;
      capability: RuntimeCapability;
    },
  ) => Promise<void> | void;
};

type ProviderIconAsset =
  | { type: "image"; src: string }
  | { type: "mask"; src: string };

type ActiveCapabilityProvider = {
  displayName: string;
  model: string;
  icon: ProviderIconAsset;
  source: "default" | "saved";
  savedConfig: SafeProviderConfig | null;
};

const MAX_OPENROUTER_MODEL_CONFIGS = 12;
const CHAT_CAPABILITY: RuntimeCapability = "chat";
const RUNTIME_STATUS_CAPABILITIES: RuntimeCapability[] = [
  "embeddings",
  "speech_to_text",
  "text_to_speech",
];
const RUNTIME_CAPABILITY_LABELS: Record<
  RuntimeCapability,
  {
    value: RuntimeCapability;
    label: string;
    description: string;
  }
> = {
  chat: {
    value: "chat",
    label: "Chat",
    description: "Answers messages",
  },
  embeddings: {
    value: "embeddings",
    label: "Embedding",
    description: "Indexes memories and files",
  },
  speech_to_text: {
    value: "speech_to_text",
    label: "Speech to text",
    description: "Transcribes voice input",
  },
  text_to_speech: {
    value: "text_to_speech",
    label: "Text to speech",
    description: "Speaks responses",
  },
};

function capabilityLabel(capability: RuntimeCapability) {
  return RUNTIME_CAPABILITY_LABELS[capability]?.label ?? "Chat";
}

function capabilityDescription(capability: RuntimeCapability) {
  return RUNTIME_CAPABILITY_LABELS[capability]?.description ?? "";
}

function iconForProviderKind(
  providerKind: string | undefined,
): ProviderIconAsset {
  return providerKind === "openrouter"
    ? { type: "mask", src: "/icons/openrouter.svg" }
    : { type: "image", src: "/icons/gemini.webp" };
}

function resolveActiveProviderForCapability({
  capability,
  runtimeDefaults,
  savedConfigs,
}: {
  capability: RuntimeCapability;
  runtimeDefaults: Record<string, RuntimeCapabilityConfig> | null;
  savedConfigs: SafeProviderConfig[];
}): ActiveCapabilityProvider {
  const savedConfig =
    savedConfigs.find(
      (config) => config.capability === capability && config.isActive,
    ) ?? null;

  if (savedConfig) {
    return {
      displayName: savedConfig.displayName,
      model: savedConfig.model,
      icon: { type: "mask", src: "/icons/openrouter.svg" },
      source: "saved",
      savedConfig,
    };
  }

  const fallback = runtimeDefaults?.[capability];

  return {
    displayName: fallback?.displayName ?? "Default model",
    model: fallback?.model ?? "Not configured",
    icon: iconForProviderKind(fallback?.providerKind),
    source: "default",
    savedConfig: null,
  };
}

export function ProviderConfigForm({
  savedConfigs,
  fallbackLabel,
  runtimeDefaults,
  isBusy,
  onConnectOpenRouter,
  onCreateOpenRouterModel,
  onSelectDefaultProvider,
  onSelectSavedProvider,
  onDeleteSavedProvider,
  onUpdateProviderModel,
}: ProviderConfigFormProps) {
  const [isAddModelDialogOpen, setIsAddModelDialogOpen] = React.useState(false);
  const [isAddingModel, setIsAddingModel] = React.useState(false);
  const activeConfig = resolveActiveProviderForCapability({
    capability: CHAT_CAPABILITY,
    runtimeDefaults,
    savedConfigs,
  });
  const visibleSavedConfigs = savedConfigs.filter(
    (config) => config.capability === CHAT_CAPABILITY,
  );

  return (
    <div className="grid gap-5">
      <ActiveProviderHero
        activeConfig={activeConfig}
        fallbackLabel={runtimeDefaults?.chat?.model ?? fallbackLabel}
      />

      <section className="grid gap-2.5">
        <SectionLabel>Chat model</SectionLabel>
        <div className="grid gap-1.5">
          <ProviderOption
            icon={iconForProviderKind(runtimeDefaults?.chat?.providerKind)}
            name="Environment default"
            detail={runtimeDefaults?.chat?.model ?? "Not configured"}
            active={!activeConfig.savedConfig}
            disabled={isBusy}
            onSelect={() => onSelectDefaultProvider(CHAT_CAPABILITY)}
          />

          {visibleSavedConfigs.map((config) => {
            const isActive = Boolean(config.isActive);
            const providerConfigId = config.id;

            return (
              <div key={config.id} className="grid gap-1">
                {isActive && providerConfigId ? (
                  <ActiveOpenRouterProvider
                    config={config}
                    disabled={isBusy}
                    onDelete={() => onDeleteSavedProvider(providerConfigId)}
                    onSelect={() => onSelectSavedProvider(providerConfigId)}
                    onUpdateProviderModel={onUpdateProviderModel}
                  />
                ) : (
                  <ProviderOption
                    icon={{ type: "mask", src: "/icons/openrouter.svg" }}
                    name={config.displayName}
                    detail={config.model}
                    active={false}
                    disabled={isBusy}
                    onSelect={() =>
                      config.id ? onSelectSavedProvider(config.id) : undefined
                    }
                    onDelete={() =>
                      config.id ? onDeleteSavedProvider(config.id) : undefined
                    }
                  />
                )}
              </div>
            );
          })}
        </div>
      </section>

      {savedConfigs.length > 0 ? (
        <AddOpenRouterModelCard
          disabled={isBusy}
          savedModelCount={savedConfigs.length}
          onOpenAddModel={() => setIsAddModelDialogOpen(true)}
        />
      ) : (
        <OpenRouterConnectCard
          disabled={isBusy}
          onConnectOpenRouter={onConnectOpenRouter}
        />
      )}

      <RuntimeDefaultsSummary runtimeDefaults={runtimeDefaults} />

      <OpenRouterModelFormDialog
        open={isAddModelDialogOpen}
        title="Add chat model"
        description="Reuses your connected OpenRouter OAuth key."
        submitLabel="Save model"
        loadingLabel="Saving"
        disabled={isBusy}
        isSaving={isAddingModel}
        onOpenChange={(open) => {
          if (!open) {
            setIsAddModelDialogOpen(false);
          }
        }}
        onSubmit={(input) => {
          setIsAddingModel(true);
          return Promise.resolve(
            onCreateOpenRouterModel({
              ...input,
              capability: CHAT_CAPABILITY,
            }),
          ).then(
            () => {
              setIsAddingModel(false);
              setIsAddModelDialogOpen(false);
            },
            (error: unknown) => {
              setIsAddingModel(false);
              throw error;
            },
          );
        }}
      />
    </div>
  );
}

/* ─── Add Model ─── */

function AddOpenRouterModelCard({
  disabled,
  savedModelCount,
  onOpenAddModel,
}: {
  disabled: boolean;
  savedModelCount: number;
  onOpenAddModel: () => void;
}) {
  const hasReachedModelLimit = savedModelCount >= MAX_OPENROUTER_MODEL_CONFIGS;

  return (
    <section className="grid gap-2">
      <SectionLabel>Add a model</SectionLabel>
      <button
        type="button"
        disabled={disabled || hasReachedModelLimit}
        aria-label={
          hasReachedModelLimit
            ? `OpenRouter model limit reached: ${MAX_OPENROUTER_MODEL_CONFIGS} models`
            : "Add OpenRouter model"
        }
        title={
          hasReachedModelLimit
            ? `OpenRouter model limit reached: ${MAX_OPENROUTER_MODEL_CONFIGS} models`
            : "Add OpenRouter model"
        }
        onClick={onOpenAddModel}
        className="group flex h-16 items-center justify-between rounded-xl border border-dashed border-white/[0.08] bg-white/[0.018] px-3 text-left transition hover:border-[rgba(var(--theme-color-rgb),0.24)] hover:bg-[rgba(var(--theme-color-rgb),0.035)] disabled:pointer-events-none disabled:opacity-50"
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[rgba(var(--theme-color-rgb),0.06)] text-[rgb(var(--theme-color-rgb))] ring-1 ring-[rgba(var(--theme-color-rgb),0.12)] transition group-hover:bg-[rgba(var(--theme-color-rgb),0.1)]">
            <ProviderIcon
              asset={{ type: "mask", src: "/icons/openrouter.svg" }}
              className="size-4"
            />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[13px] font-medium text-white/82">
              Add chat model
            </span>
            <span className="block truncate text-[12px] text-white/30">
              {hasReachedModelLimit
                ? `Limit reached: ${MAX_OPENROUTER_MODEL_CONFIGS} models`
                : "Paste an OpenRouter model ID"}
            </span>
          </span>
        </span>
        <Cloud className="size-4 shrink-0 text-white/18 transition group-hover:text-[rgba(var(--theme-color-rgb),0.58)]" />
      </button>
    </section>
  );
}

function RuntimeDefaultsSummary({
  runtimeDefaults,
}: {
  runtimeDefaults: Record<string, RuntimeCapabilityConfig> | null;
}) {
  return (
    <section className="grid gap-2.5">
      <SectionLabel>Runtime defaults</SectionLabel>
      <div className="grid gap-1 rounded-xl border border-white/[0.06] bg-black/18 p-1.5">
        {RUNTIME_STATUS_CAPABILITIES.map((capability) => {
          const config = runtimeDefaults?.[capability];
          return (
            <div
              key={capability}
              className="grid min-w-0 grid-cols-[minmax(7rem,0.7fr)_minmax(0,1.3fr)] items-center gap-3 rounded-lg px-2.5 py-2"
            >
              <span className="truncate text-[12px] font-medium text-white/52">
                {capabilityLabel(capability)}
              </span>
              <span className="min-w-0 truncate text-right font-mono text-[11px] text-white/34">
                {config?.configured === false
                  ? "Not configured"
                  : (config?.model ?? "Environment")}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function OpenRouterModelFormDialog({
  open,
  title,
  description,
  submitLabel,
  loadingLabel,
  disabled,
  isSaving,
  initialDisplayName = "",
  initialModel = "",
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  title: string;
  description: string;
  submitLabel: string;
  loadingLabel: string;
  disabled: boolean;
  isSaving: boolean;
  initialDisplayName?: string;
  initialModel?: string;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: {
    displayName: string;
    model: string;
  }) => Promise<void> | void;
}) {
  const nameInputRef = React.useRef<HTMLInputElement>(null);
  const modelInputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (!open) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      nameInputRef.current?.focus();
    });

    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  function pasteModelId(text: string) {
    const modelId = text.trim();
    if (!modelId) {
      toast.warning("Clipboard is empty");
      return false;
    }

    if (!modelInputRef.current) {
      return false;
    }

    modelInputRef.current.value = modelId;
    modelInputRef.current.focus();
    return true;
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!isSaving) {
          onOpenChange(nextOpen);
        }
      }}
      modal
    >
      <DialogContent className="overflow-hidden">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <form
          key={`${initialDisplayName}:${initialModel}`}
          className="px-5 py-4"
          onSubmit={(event) => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            const displayName = String(
              formData.get("displayName") ?? "",
            ).trim();
            const model = String(formData.get("model") ?? "").trim();

            if (!displayName) {
              toast.error("Name required", {
                description: "Add a short name so this model is easy to find.",
              });
              return;
            }

            if (!model || /\s/.test(model)) {
              toast.error("Invalid model ID", {
                description: "Use the OpenRouter model slug without spaces.",
              });
              return;
            }

            void onSubmit({ displayName, model });
          }}
        >
          <div className="grid gap-3">
            <label className="grid gap-1.5">
              <span className="text-[11px] font-medium text-white/42">
                Name
              </span>
              <input
                ref={nameInputRef}
                aria-label="Provider name"
                name="displayName"
                disabled={disabled || isSaving}
                defaultValue={initialDisplayName}
                placeholder="Writing model"
                maxLength={80}
                autoComplete="off"
                className="h-10 w-full rounded-lg border border-white/[0.08] bg-black/24 px-3 text-[13px] text-white/84 outline-none transition placeholder:text-white/18 selection:bg-[rgba(var(--theme-color-rgb),0.34)] focus:border-[rgba(var(--theme-color-rgb),0.38)] focus:bg-black/32 focus:ring-2 focus:ring-[rgba(var(--theme-color-rgb),0.1)] disabled:opacity-50"
              />
            </label>

            <label className="grid min-w-0 gap-1.5">
              <span className="text-[11px] font-medium text-white/42">
                OpenRouter model ID
              </span>
              <div className="flex gap-2">
                <input
                  ref={modelInputRef}
                  aria-label="OpenRouter model ID"
                  name="model"
                  disabled={disabled || isSaving}
                  defaultValue={initialModel}
                  placeholder="provider/model-id"
                  spellCheck={false}
                  autoCapitalize="none"
                  autoComplete="off"
                  className="h-10 min-w-0 flex-1 rounded-lg border border-white/[0.08] bg-black/24 px-3 font-mono text-[12px] text-white/82 outline-none transition placeholder:text-white/18 selection:bg-[rgba(var(--theme-color-rgb),0.34)] focus:border-[rgba(var(--theme-color-rgb),0.38)] focus:bg-black/32 focus:ring-2 focus:ring-[rgba(var(--theme-color-rgb),0.1)] disabled:opacity-50"
                />
                <ClipboardActionButton
                  action="paste"
                  disabled={disabled || isSaving}
                  aria-label="Paste model ID"
                  feedbackLabel="Pasted"
                  onClipboardPaste={pasteModelId}
                  className="size-10 shrink-0 rounded-lg border border-white/[0.08] bg-white/[0.035] text-white/42 hover:border-white/[0.14] hover:bg-white/[0.06] hover:text-white/72"
                  iconClassName="size-4"
                />
              </div>
            </label>
          </div>

          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              disabled={isSaving}
              onClick={() => onOpenChange(false)}
              className="h-10 rounded-lg border border-white/[0.08] px-3 text-[12px] font-semibold text-white/58 transition hover:border-white/[0.14] hover:bg-white/[0.045] hover:text-white/82 disabled:pointer-events-none disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={disabled || isSaving}
              className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-emerald-400/24 bg-emerald-400/10 px-3 text-[12px] font-semibold text-emerald-300 transition hover:border-emerald-300/42 hover:bg-emerald-400/14 disabled:pointer-events-none disabled:border-white/[0.06] disabled:bg-white/[0.025] disabled:text-white/16"
            >
              {isSaving ? <Loader2 className="size-3.5 animate-spin" /> : null}
              {isSaving ? loadingLabel : submitLabel}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ─── Active Provider Hero ─── */

function ActiveProviderHero({
  activeConfig,
  fallbackLabel,
}: {
  activeConfig: ActiveCapabilityProvider;
  fallbackLabel: string | null;
}) {
  const modelName = activeConfig.model || fallbackLabel || "Not configured";

  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/[0.08] bg-black/26 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]">
      <div className="relative flex items-center gap-4 px-5 py-4">
        <div className="grid size-12 shrink-0 place-items-center rounded-[14px] bg-black/30 ring-1 ring-white/[0.08]">
          <ProviderIcon
            asset={activeConfig.icon}
            className="size-6 text-[rgb(var(--theme-color-rgb))]"
          />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-emerald-400">
              <span className="relative flex size-1.5">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                <span className="relative inline-flex size-1.5 rounded-full bg-emerald-400" />
              </span>
              Active chat model
            </span>
          </div>
          <div className="mt-1 truncate text-[15px] font-semibold tracking-tight text-white">
            {modelName}
          </div>
          <div className="mt-0.5 truncate text-[11px] text-white/30">
            {capabilityDescription(CHAT_CAPABILITY)}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Provider Option ─── */

function ProviderOption({
  icon,
  name,
  detail,
  active,
  disabled,
  onSelect,
  onDelete,
}: {
  icon: ProviderIconAsset;
  name: string;
  detail: string;
  active: boolean;
  disabled: boolean;
  onSelect: () => void;
  onDelete?: () => void;
}) {
  return (
    <div
      className={cn(
        "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 transition-all duration-200",
        active
          ? "bg-emerald-500/[0.06] ring-1 ring-emerald-500/20"
          : "hover:bg-white/[0.04]",
      )}
    >
      {/* Radio indicator */}
      <button
        type="button"
        onClick={onSelect}
        disabled={disabled}
        title={`Select ${name}`}
        aria-label={active ? `${name} is active` : `Select ${name}`}
        className={cn(
          "grid size-4.5 shrink-0 place-items-center rounded-full border-[1.5px] transition-all duration-200 disabled:opacity-50",
          active
            ? "border-emerald-400 bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.3)]"
            : "border-white/20 hover:border-white/40",
        )}
      >
        {active ? (
          <Check className="size-2.5 text-black" strokeWidth={3} />
        ) : null}
      </button>
      <div className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-white/[0.04] ring-1 ring-white/[0.06]">
        <ProviderIcon
          asset={icon}
          className="size-4.5 text-[rgb(var(--theme-color-rgb))]"
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13px] font-medium text-white/90">
            {name}
          </span>
        </div>
        <div className="mt-0.5 truncate text-[12px] text-white/32">
          {detail}
        </div>
      </div>
      {onDelete ? (
        <button
          type="button"
          disabled={disabled}
          title={`Delete ${name}`}
          aria-label={`Delete ${name}`}
          onClick={onDelete}
          className="grid size-7 shrink-0 place-items-center rounded-lg text-white/20 opacity-0 transition-all duration-200 hover:bg-red-500/10 hover:text-red-400 group-hover:opacity-100 disabled:opacity-50"
        >
          <Trash2 className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}

/* ─── Active OpenRouter ─── */

function ActiveOpenRouterProvider({
  config,
  disabled,
  onDelete,
  onSelect,
  onUpdateProviderModel,
}: {
  config: SafeProviderConfig;
  disabled: boolean;
  onDelete: () => void;
  onSelect: () => void;
  onUpdateProviderModel: (
    providerConfigId: string,
    input: {
      displayName: string;
      model: string;
      capability: RuntimeCapability;
    },
  ) => Promise<void> | void;
}) {
  const [isEditProviderDialogOpen, setIsEditProviderDialogOpen] =
    React.useState(false);
  const [isProviderSaving, setIsProviderSaving] = React.useState(false);

  return (
    <article className="relative overflow-hidden rounded-2xl border border-emerald-400/18 bg-[linear-gradient(135deg,rgba(16,42,40,0.62),rgba(6,13,14,0.72))] px-3 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-emerald-300/28 to-transparent" />
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onSelect}
          disabled={disabled}
          title={`${config.displayName} is active`}
          aria-label={`${config.displayName} is active`}
          className="grid size-4.5 shrink-0 place-items-center rounded-full border-[1.5px] border-emerald-400 bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.3)] disabled:opacity-50"
        >
          <Check className="size-2.5 text-black" strokeWidth={3} />
        </button>

        <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/[0.045] ring-1 ring-white/[0.07]">
          <ProviderIcon
            asset={{ type: "mask", src: "/icons/openrouter.svg" }}
            className="size-5 text-[rgb(var(--theme-color-rgb))]"
          />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[13px] font-semibold text-white/92">
              {config.displayName}
            </span>
          </div>
          <div className="mt-0.5 truncate font-mono text-[11px] text-white/36">
            {config.model}
          </div>
        </div>

        <button
          type="button"
          disabled={disabled}
          title={`Delete ${config.displayName}`}
          aria-label={`Delete ${config.displayName}`}
          onClick={onDelete}
          className="grid size-8 shrink-0 place-items-center rounded-lg border border-white/[0.06] text-white/24 transition hover:border-red-400/24 hover:bg-red-500/10 hover:text-red-300 disabled:opacity-50"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>

      <div className="mt-3 border-t border-white/[0.06] pt-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() => setIsEditProviderDialogOpen(true)}
          className="flex h-8 w-full items-center justify-between rounded-lg px-2 text-left text-[12px] font-medium text-white/42 transition hover:bg-white/[0.035] hover:text-white/66 disabled:pointer-events-none disabled:opacity-50"
        >
          <span>Edit</span>
        </button>
      </div>

      <OpenRouterModelFormDialog
        open={isEditProviderDialogOpen}
        title="Edit provider"
        description="Update the saved name and OpenRouter model ID."
        submitLabel="Save"
        loadingLabel="Saving"
        disabled={disabled}
        isSaving={isProviderSaving}
        initialDisplayName={config.displayName}
        initialModel={config.model}
        onOpenChange={setIsEditProviderDialogOpen}
        onSubmit={(input) => {
          if (
            !config.id ||
            (input.displayName === config.displayName &&
              input.model === config.model)
          ) {
            setIsEditProviderDialogOpen(false);
            return undefined;
          }

          setIsProviderSaving(true);
          return Promise.resolve(
            onUpdateProviderModel(config.id, {
              ...input,
              capability: CHAT_CAPABILITY,
            }),
          ).then(
            () => {
              setIsProviderSaving(false);
              setIsEditProviderDialogOpen(false);
            },
            (error: unknown) => {
              setIsProviderSaving(false);
              throw error;
            },
          );
        }}
      />
    </article>
  );
}

/* ─── OpenRouter Connect Card ─── */

function OpenRouterConnectCard({
  disabled,
  onConnectOpenRouter,
}: {
  disabled: boolean;
  onConnectOpenRouter: () => void;
}) {
  return (
    <section className="grid gap-2">
      <SectionLabel>Add a provider</SectionLabel>
      <button
        type="button"
        onClick={onConnectOpenRouter}
        disabled={disabled}
        aria-label="Connect OpenRouter with OAuth"
        title="Connect OpenRouter with OAuth"
        className="group flex items-center gap-3 rounded-xl border border-dashed border-white/[0.08] px-3.5 py-3 text-left transition-all duration-200 hover:border-[rgba(var(--theme-color-rgb),0.24)] hover:bg-[rgba(var(--theme-color-rgb),0.03)] disabled:pointer-events-none disabled:opacity-50"
      >
        <div className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-[rgba(var(--theme-color-rgb),0.06)] text-[rgb(var(--theme-color-rgb))] ring-1 ring-[rgba(var(--theme-color-rgb),0.14)] transition-all duration-200 group-hover:bg-[rgba(var(--theme-color-rgb),0.1)] group-hover:ring-[rgba(var(--theme-color-rgb),0.3)]">
          <ProviderIcon
            asset={{ type: "mask", src: "/icons/openrouter.svg" }}
            className="size-[18px]"
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium text-white/80 transition group-hover:text-white">
            Connect with OpenRouter
          </div>
          <div className="text-[12px] text-white/28">
            OAuth · 300+ models · no API key needed
          </div>
        </div>
        <Cloud className="size-4 text-white/16 transition-all duration-200 group-hover:text-[rgba(var(--theme-color-rgb),0.6)]" />
      </button>
    </section>
  );
}

/* ─── Shared ─── */

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[11px] font-medium uppercase tracking-[0.06em] text-white/24">
      {children}
    </h3>
  );
}

function ProviderIcon({
  asset,
  className,
}: {
  asset: ProviderIconAsset;
  className?: string;
}) {
  if (asset.type === "image") {
    return (
      <img
        src={asset.src}
        alt=""
        aria-hidden="true"
        className={cn("block object-contain", className)}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className={cn("inline-block bg-current", className)}
      style={{
        WebkitMask: `url('${asset.src}') center / contain no-repeat`,
        mask: `url('${asset.src}') center / contain no-repeat`,
      }}
    />
  );
}
