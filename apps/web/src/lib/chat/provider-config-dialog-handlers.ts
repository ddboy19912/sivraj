import {
  disconnectProviderDialogConfig,
  saveProviderDialogConfig,
  testProviderDialogConfig,
} from "@/lib/chat/provider-config-dialog-actions";
import type { ProviderConfigResponse, ProviderKind } from "@/lib/chat/chat-api";
import type { Session } from "@/lib/session";

type ProviderDialogState = {
  providerKind: ProviderKind;
  displayName: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  canSubmit: boolean;
  isBusy: boolean;
  setIsBusy: (value: boolean) => void;
  setStatus: (value: string | null) => void;
  setHasSavedApiKey: (value: boolean) => void;
  setApiKey: (value: string) => void;
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
    state.setStatus(error instanceof Error ? error.message : "Provider action failed.");
  } finally {
    state.setIsBusy(false);
  }
}

export function createProviderConfigDialogHandlers({
  session,
  state,
  onSessionRefreshed,
  onProviderChanged,
}: ProviderDialogHandlersInput) {
  async function handleSave() {
    if (!session || !state.canSubmit || state.isBusy) {
      return;
    }

    await runProviderDialogAction(state, async () => {
      const response = await saveProviderDialogConfig({
        session,
        values: {
          providerKind: state.providerKind,
          displayName: state.displayName,
          baseUrl: state.baseUrl,
          model: state.model,
          apiKey: state.apiKey,
        },
        onSessionRefreshed,
      });
      state.setHasSavedApiKey(response.config.hasApiKey);
      state.setApiKey("");
      onProviderChanged({ config: response.config, fallback: null });
      state.setStatus("Provider saved.");
    });
  }

  async function handleTest() {
    if (!session || !state.canSubmit || state.isBusy) {
      return;
    }

    await runProviderDialogAction(state, async () => {
      const response = await testProviderDialogConfig({
        session,
        values: {
          providerKind: state.providerKind,
          displayName: state.displayName,
          baseUrl: state.baseUrl,
          model: state.model,
          apiKey: state.apiKey,
        },
        onSessionRefreshed,
      });
      state.setStatus(`Connected: ${response.sample || response.model}`);
    });
  }

  async function handleDisconnect() {
    if (!session || state.isBusy) {
      return;
    }

    await runProviderDialogAction(state, async () => {
      const response = await disconnectProviderDialogConfig({
        session,
        onSessionRefreshed,
      });
      state.setHasSavedApiKey(false);
      state.setApiKey("");
      onProviderChanged(response);
      state.setStatus("Provider disconnected.");
    });
  }

  return { handleDisconnect, handleSave, handleTest };
}
