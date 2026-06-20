import {
  completeOpenRouterProviderDialogOAuth,
  createProviderDialogOpenRouterModel,
  deleteProviderDialogConfig,
  selectDefaultProviderDialogConfig,
  selectProviderDialogConfig,
  startOpenRouterProviderDialogOAuth,
  updateProviderDialogModel,
} from "@/lib/chat/provider-config-dialog-actions";
import { toast } from "sonner";
import type {
  ProviderConfigResponse,
  RuntimeCapability,
  RuntimeCapabilityConfig,
  SafeProviderConfig,
} from "@/lib/chat/chat-api";
import type { Session } from "@/lib/session";

type ProviderDialogState = {
  activeProviderConfigId: string | null;
  isBusy: boolean;
  savedConfigs: SafeProviderConfig[];
  fallbackLabel: string | null;
  runtimeDefaults: Record<string, RuntimeCapabilityConfig> | null;
  setIsBusy: (value: boolean) => void;
  setStatus: (value: string | null) => void;
  setHasSavedApiKey: (value: boolean) => void;
  setRuntimeDefaults: (value: Record<string, RuntimeCapabilityConfig> | null) => void;
  setSavedConfigs: (value: SafeProviderConfig[]) => void;
  setActiveProviderConfigId: (value: string | null) => void;
};

type ProviderDialogHandlersInput = {
  session: Session | null;
  state: ProviderDialogState;
  onSessionRefreshed: (session: Session) => void;
  onProviderChanged: (response: ProviderConfigResponse | null) => void;
};

async function runProviderDialogAction(
  state: ProviderDialogState,
  action: () => Promise<void>,
) {
  state.setIsBusy(true);
  state.setStatus(null);
  try {
    await action();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Provider action failed.";
    toast.error("Provider action failed", { description: message });
  } finally {
    state.setIsBusy(false);
  }
}

function applyProviderResponse(
  state: ProviderDialogState,
  response: ProviderConfigResponse,
  onProviderChanged: (response: ProviderConfigResponse | null) => void,
) {
  const activeConfig = response.activeConfig ?? response.config;
  state.setSavedConfigs(response.configs ?? []);
  state.setActiveProviderConfigId(activeConfig?.id ?? null);
  state.setHasSavedApiKey(Boolean(activeConfig?.hasApiKey));
  state.setRuntimeDefaults(response.runtimeDefaults ?? null);
  onProviderChanged(response);
}

export function createProviderConfigDialogHandlers({
  session,
  state,
  onSessionRefreshed,
  onProviderChanged,
}: ProviderDialogHandlersInput) {
  async function handleConnectOpenRouter() {
    if (!session || state.isBusy) {
      return;
    }

    await runProviderDialogAction(state, async () => {
      await startOpenRouterProviderDialogOAuth({ session, onSessionRefreshed });
      toast("Opening OpenRouter", {
        description: "Complete OAuth to connect your provider.",
      });
    });
  }

  async function handleCompleteOpenRouterOAuth() {
    if (!session || state.isBusy) {
      return;
    }

    await runProviderDialogAction(state, async () => {
      const response = await completeOpenRouterProviderDialogOAuth({
        session,
        onSessionRefreshed,
      });

      if (!response) {
        return;
      }

      applyProviderResponse(state, response, onProviderChanged);
      toast.success("OpenRouter connected", {
        description: "OAuth credential saved.",
      });
    });
  }

  async function handleSelectProvider(providerConfigId: string) {
    if (!session || state.isBusy) {
      return;
    }

    await runProviderDialogAction(state, async () => {
      const response = await selectProviderDialogConfig({
        session,
        providerConfigId,
        onSessionRefreshed,
      });
      applyProviderResponse(state, response, onProviderChanged);
      toast.success("Provider selected", {
        description: "Sivraj will use this provider for new responses.",
      });
    });
  }

  async function handleSelectDefaultProvider(capability: RuntimeCapability) {
    if (!session || state.isBusy) {
      return;
    }

    await runProviderDialogAction(state, async () => {
      const response = await selectDefaultProviderDialogConfig({
        session,
        capability,
        onSessionRefreshed,
      });
      applyProviderResponse(state, response, onProviderChanged);
      toast.success("Default provider selected", {
        description:
          state.runtimeDefaults?.[capability]?.model ??
          state.fallbackLabel ??
          "Sivraj will use the default model.",
      });
    });
  }

  async function handleDeleteProvider(providerConfigId: string) {
    if (!session || state.isBusy) {
      return;
    }

    await runProviderDialogAction(state, async () => {
      const response = await deleteProviderDialogConfig({
        session,
        providerConfigId,
        onSessionRefreshed,
      });
      applyProviderResponse(state, response, onProviderChanged);
      toast.success("Provider deleted", {
        description: "Saved credentials were removed for this provider.",
      });
    });
  }

  async function handleCreateOpenRouterModel(input: {
    displayName: string;
    model: string;
    capability: RuntimeCapability;
  }) {
    if (!session || state.isBusy) {
      return;
    }

    await runProviderDialogAction(state, async () => {
      const response = await createProviderDialogOpenRouterModel({
        session,
        displayName: input.displayName,
        model: input.model,
        capability: input.capability,
        onSessionRefreshed,
      });
      applyProviderResponse(state, response, onProviderChanged);
      toast.success("Model added", {
        description: input.displayName,
      });
    });
  }

  async function handleUpdateProviderModel(
    providerConfigId: string,
    input: {
      displayName: string;
      model: string;
      capability: RuntimeCapability;
    },
  ) {
    if (!session || state.isBusy) {
      return;
    }

    await runProviderDialogAction(state, async () => {
      const response = await updateProviderDialogModel({
        session,
        providerConfigId,
        displayName: input.displayName,
        model: input.model,
        capability: input.capability,
        onSessionRefreshed,
      });
      applyProviderResponse(state, response, onProviderChanged);
      toast.success("Provider updated", {
        description: input.displayName,
      });
    });
  }

  return {
    handleCompleteOpenRouterOAuth,
    handleConnectOpenRouter,
    handleCreateOpenRouterModel,
    handleDeleteProvider,
    handleSelectDefaultProvider,
    handleSelectProvider,
    handleUpdateProviderModel,
  };
}
