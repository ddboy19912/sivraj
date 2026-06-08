import {
  disconnectProviderConfig,
  loadProviderConfig,
  saveProviderConfig,
  testProviderConfig,
  type ProviderKind,
  type ProviderConfigResponse,
} from "@/lib/chat/chat-api";
import type { Session } from "@/lib/session";

type ProviderFormValues = {
  providerKind: ProviderKind;
  displayName: string;
  baseUrl: string;
  model: string;
  apiKey: string;
};

export async function saveProviderConfigValues(
  values: ProviderFormValues,
  session: Session,
  onSessionRefreshed: (session: Session) => void,
) {
  return saveProviderConfig(
    {
      providerKind: values.providerKind,
      displayName: values.displayName,
      baseUrl: values.baseUrl,
      model: values.model,
      ...(values.apiKey.trim() ? { apiKey: values.apiKey.trim() } : {}),
    },
    session,
    onSessionRefreshed,
  );
}

export async function testProviderConfigValues(
  values: ProviderFormValues,
  session: Session,
  onSessionRefreshed: (session: Session) => void,
) {
  return testProviderConfig(
    {
      providerKind: values.providerKind,
      displayName: values.displayName,
      baseUrl: values.baseUrl,
      model: values.model,
      ...(values.apiKey.trim() ? { apiKey: values.apiKey.trim() } : {}),
    },
    session,
    onSessionRefreshed,
  );
}

export async function disconnectAndReloadProviderConfig(
  session: Session,
  onSessionRefreshed: (session: Session) => void,
): Promise<ProviderConfigResponse> {
  await disconnectProviderConfig(session, onSessionRefreshed);
  return loadProviderConfig(session, onSessionRefreshed);
}
