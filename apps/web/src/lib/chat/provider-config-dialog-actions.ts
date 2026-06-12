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
  onSessionRefreshed,
}: {
  session: Session;
  displayName: string;
  model: string;
  onSessionRefreshed: (session: Session) => void;
}) {
  return createSavedOpenRouterModelConfig(
    { displayName, model },
    session,
    onSessionRefreshed,
  );
}

export function selectDefaultProviderDialogConfig({
  session,
  onSessionRefreshed,
}: {
  session: Session;
  onSessionRefreshed: (session: Session) => void;
}) {
  return selectDefaultProviderConfig(session, onSessionRefreshed);
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
  onSessionRefreshed,
}: {
  session: Session;
  providerConfigId: string;
  displayName: string;
  model: string;
  onSessionRefreshed: (session: Session) => void;
}) {
  return updateSavedProviderModel(
    providerConfigId,
    { displayName, model },
    session,
    onSessionRefreshed,
  );
}
