import {
  disconnectAndReloadProviderConfig,
  saveProviderConfigValues,
  testProviderConfigValues,
} from "@/lib/chat/provider-config-handlers";
import type { ProviderConfigResponse, ProviderKind } from "@/lib/chat/chat-api";
import type { Session } from "@/lib/session";

type ProviderDialogFormValues = {
  providerKind: ProviderKind;
  displayName: string;
  baseUrl: string;
  model: string;
  apiKey: string;
};

type ProviderDialogActionInput = {
  session: Session;
  values: ProviderDialogFormValues;
  onSessionRefreshed: (session: Session) => void;
};

export async function saveProviderDialogConfig({
  session,
  values,
  onSessionRefreshed,
}: ProviderDialogActionInput) {
  return saveProviderConfigValues(values, session, onSessionRefreshed);
}

export async function testProviderDialogConfig({
  session,
  values,
  onSessionRefreshed,
}: ProviderDialogActionInput) {
  return testProviderConfigValues(values, session, onSessionRefreshed);
}

export async function disconnectProviderDialogConfig({
  session,
  onSessionRefreshed,
}: {
  session: Session;
  onSessionRefreshed: (session: Session) => void;
}): Promise<ProviderConfigResponse> {
  return disconnectAndReloadProviderConfig(session, onSessionRefreshed);
}
