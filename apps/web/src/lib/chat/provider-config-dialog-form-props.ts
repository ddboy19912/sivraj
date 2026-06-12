import type { ProviderConfigFormProps } from "@/components/chat/ProviderConfigForm";
import type { SafeProviderConfig } from "@/lib/chat/chat-api";

type ProviderConfigDialogState = {
  activeProviderConfigId: string | null;
  savedConfigs: SafeProviderConfig[];
  fallbackLabel: string | null;
  isBusy: boolean;
  handleConnectOpenRouter: () => void;
  handleCreateOpenRouterModel: (input: {
    displayName: string;
    model: string;
  }) => Promise<void> | void;
  handleSelectProvider: (providerConfigId: string) => void;
  handleDeleteProvider: (providerConfigId: string) => void;
  handleSelectDefaultProvider: () => void;
  handleUpdateProviderModel: (
    providerConfigId: string,
    input: {
      displayName: string;
      model: string;
    },
  ) => Promise<void> | void;
};

export function buildProviderConfigDialogFormProps(
  config: ProviderConfigDialogState,
): ProviderConfigFormProps {
  return {
    activeProviderConfigId: config.activeProviderConfigId,
    savedConfigs: config.savedConfigs,
    fallbackLabel: config.fallbackLabel,
    isBusy: config.isBusy,
    onConnectOpenRouter: config.handleConnectOpenRouter,
    onCreateOpenRouterModel: config.handleCreateOpenRouterModel,
    onSelectSavedProvider: config.handleSelectProvider,
    onSelectDefaultProvider: config.handleSelectDefaultProvider,
    onDeleteSavedProvider: config.handleDeleteProvider,
    onUpdateProviderModel: config.handleUpdateProviderModel,
  };
}
