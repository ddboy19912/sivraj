import { useState } from "react";
import { PROVIDER_PRESETS, providerKeyHint } from "@/lib/chat/provider-config-presets";
import type { ProviderKind } from "@/lib/chat/chat-api";
import type { Session } from "@/lib/session";

export function useProviderConfigFields(session: Session | null) {
  const [providerKind, setProviderKind] = useState<ProviderKind>("openrouter");
  const [displayName, setDisplayName] = useState(PROVIDER_PRESETS.openrouter.label);
  const [baseUrl, setBaseUrl] = useState(PROVIDER_PRESETS.openrouter.baseUrl);
  const [model, setModel] = useState(PROVIDER_PRESETS.openrouter.model);
  const [apiKey, setApiKey] = useState("");
  const [hasSavedApiKey, setHasSavedApiKey] = useState(false);
  const [fallbackLabel, setFallbackLabel] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const preset = PROVIDER_PRESETS[providerKind];
  const canSubmit = Boolean(session && model.trim() && baseUrl.trim());
  const keyHint = providerKeyHint(
    providerKind,
    hasSavedApiKey,
    apiKey,
    preset.apiKeyRequired,
  );

  function selectProvider(kind: ProviderKind) {
    const next = PROVIDER_PRESETS[kind];
    setProviderKind(kind);
    setDisplayName(next.label);
    setBaseUrl(next.baseUrl);
    setModel(next.model);
    setApiKey("");
    setStatus(null);
  }

  return {
    apiKey,
    baseUrl,
    canSubmit,
    displayName,
    fallbackLabel,
    hasSavedApiKey,
    isBusy,
    keyHint,
    model,
    providerKind,
    selectProvider,
    setApiKey,
    setBaseUrl,
    setDisplayName,
    setFallbackLabel,
    setHasSavedApiKey,
    setIsBusy,
    setModel,
    setProviderKind,
    setStatus,
    status,
  };
}
