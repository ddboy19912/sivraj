import type { ProviderKind, ProviderConfigResponse } from "@/lib/chat/chat-api";

export type ProviderConfigSetters = {
  setProviderKind: (value: ProviderKind) => void;
  setDisplayName: (value: string) => void;
  setBaseUrl: (value: string) => void;
  setModel: (value: string) => void;
  setHasSavedApiKey: (value: boolean) => void;
  setApiKey: (value: string) => void;
  setFallbackLabel: (value: string | null) => void;
};

export function applyLoadedProviderConfig(
  response: ProviderConfigResponse,
  setters: ProviderConfigSetters,
) {
  if (response.config) {
    const kind = response.config.providerKind;
    setters.setProviderKind(kind);
    setters.setDisplayName(response.config.displayName);
    setters.setBaseUrl(response.config.baseUrl);
    setters.setModel(response.config.model);
    setters.setHasSavedApiKey(response.config.hasApiKey);
    setters.setApiKey("");
  }

  setters.setFallbackLabel(
    response.fallback
      ? `${response.fallback.displayName} ${response.fallback.model}`
      : null,
  );
}
