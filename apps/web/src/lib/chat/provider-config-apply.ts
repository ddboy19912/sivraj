import type {
  ProviderConfigResponse,
  SafeProviderConfig,
} from "@/lib/chat/chat-api";

export type ProviderConfigSetters = {
  setHasSavedApiKey: (value: boolean) => void;
  setFallbackLabel: (value: string | null) => void;
  setSavedConfigs: (value: SafeProviderConfig[]) => void;
  setActiveProviderConfigId: (value: string | null) => void;
};

export function applyLoadedProviderConfig(
  response: ProviderConfigResponse,
  setters: ProviderConfigSetters,
) {
  const activeConfig = response.activeConfig ?? response.config;

  if (activeConfig) {
    setters.setHasSavedApiKey(activeConfig.hasApiKey);
  } else {
    setters.setHasSavedApiKey(false);
  }

  setters.setSavedConfigs(response.configs ?? []);
  setters.setActiveProviderConfigId(activeConfig?.id ?? null);
  setters.setFallbackLabel(
    response.fallback
      ? response.fallback.model
      : null,
  );
}
