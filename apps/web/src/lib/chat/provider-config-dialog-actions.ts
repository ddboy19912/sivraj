import {
  beginOpenRouterOAuth,
  completeStoredOpenRouterOAuth,
  createSavedOpenRouterModelConfig,
  deleteSavedProviderConfig,
  selectDefaultProviderConfig,
  selectSavedProviderConfig,
  updateSavedProviderModel,
} from "@/lib/chat/provider-config-handlers";
import type { Session } from "@/lib/session";
import type { RuntimeCapability } from "@/lib/chat/chat-api";

export function startOpenRouterProviderDialogOAuth({
  session,
  onSessionRefreshed,
}: {
  session: Session;
  onSessionRefreshed: (session: Session) => void;
}) {
  return beginOpenRouterOAuth(session, onSessionRefreshed);
}

export function completeOpenRouterProviderDialogOAuth({
  session,
  onSessionRefreshed,
}: {
  session: Session;
  onSessionRefreshed: (session: Session) => void;
}) {
  return completeStoredOpenRouterOAuth(session, onSessionRefreshed);
}

export function selectProviderDialogConfig({
  session,
  providerConfigId,
  onSessionRefreshed,
}: {
  session: Session;
  providerConfigId: string;
  onSessionRefreshed: (session: Session) => void;
}) {
  return selectSavedProviderConfig(providerConfigId, session, onSessionRefreshed);
}

export function createProviderDialogOpenRouterModel({
  session,
  displayName,
  model,
  capability,
  onSessionRefreshed,
}: {
  session: Session;
  displayName: string;
  model: string;
  capability: RuntimeCapability;
  onSessionRefreshed: (session: Session) => void;
}) {
  return createSavedOpenRouterModelConfig(
    { displayName, model, capability },
    session,
    onSessionRefreshed,
  );
}

export function selectDefaultProviderDialogConfig({
  session,
  capability,
  onSessionRefreshed,
}: {
  session: Session;
  capability: RuntimeCapability;
  onSessionRefreshed: (session: Session) => void;
}) {
  return selectDefaultProviderConfig(capability, session, onSessionRefreshed);
}

export function deleteProviderDialogConfig({
  session,
  providerConfigId,
  onSessionRefreshed,
}: {
  session: Session;
  providerConfigId: string;
  onSessionRefreshed: (session: Session) => void;
}) {
  return deleteSavedProviderConfig(providerConfigId, session, onSessionRefreshed);
}

export function updateProviderDialogModel({
  session,
  providerConfigId,
  displayName,
  model,
  capability,
  onSessionRefreshed,
}: {
  session: Session;
  providerConfigId: string;
  displayName: string;
  model: string;
  capability: RuntimeCapability;
  onSessionRefreshed: (session: Session) => void;
}) {
  return updateSavedProviderModel(
    providerConfigId,
    { displayName, model, capability },
    session,
    onSessionRefreshed,
  );
}
