import type { ProviderConfigFormProps } from "@/components/chat/ProviderConfigForm";
import type { ProviderKind } from "@/lib/chat/chat-api";

type ProviderConfigDialogState = {
  providerKind: ProviderKind;
  displayName: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  hasSavedApiKey: boolean;
  keyHint: string;
  fallbackLabel: string | null;
  status: string | null;
  selectProvider: (kind: ProviderKind) => void;
  setDisplayName: (value: string) => void;
  setBaseUrl: (value: string) => void;
  setModel: (value: string) => void;
  setApiKey: (value: string) => void;
};

export function buildProviderConfigDialogFormProps(
  config: ProviderConfigDialogState,
): ProviderConfigFormProps {
  return {
    providerKind: config.providerKind,
    displayName: config.displayName,
    baseUrl: config.baseUrl,
    model: config.model,
    apiKey: config.apiKey,
    hasSavedApiKey: config.hasSavedApiKey,
    keyHint: config.keyHint,
    fallbackLabel: config.fallbackLabel,
    status: config.status,
    onSelectProvider: config.selectProvider,
    onDisplayNameChange: config.setDisplayName,
    onBaseUrlChange: config.setBaseUrl,
    onModelChange: config.setModel,
    onApiKeyChange: config.setApiKey,
  };
}
