import { errorMessage, getAuthedJson, postAuthedJson } from "@/lib/api";
import type {
  ConnectorAccountResponse,
  ConnectorSyncResponse,
  ConnectorsResponse,
} from "@/types/console.types";
import type { Session } from "@/lib/session";

export async function loadConnectorAccounts(
  session: Session,
  onSessionRefreshed: (session: Session) => void,
) {
  return getAuthedJson<ConnectorsResponse>(
    `/v1/twins/${session.twinId}/connectors`,
    session,
    onSessionRefreshed,
  );
}

export async function connectConnectorSource({
  session,
  provider,
  displayName,
  sourceId,
  sourceName,
  sourceUri,
  syncCadence,
  onSessionRefreshed,
}: {
  session: Session;
  provider: string;
  displayName: string;
  sourceId: string;
  sourceName: string;
  sourceUri: string;
  syncCadence: string;
  onSessionRefreshed: (session: Session) => void;
}) {
  return postAuthedJson<ConnectorAccountResponse>(
    `/v1/twins/${session.twinId}/connectors/accounts`,
    {
      provider,
      displayName: displayName.trim(),
      externalAccountId: displayName.trim(),
      syncCadence,
      source: sourceId.trim()
        ? {
            externalSourceId: sourceId.trim(),
            displayName: sourceName.trim() || sourceId.trim(),
            uri: sourceUri.trim() || undefined,
          }
        : undefined,
    },
    session,
    onSessionRefreshed,
  );
}

export async function syncConnectorAccount({
  session,
  accountId,
  connectorSourceId,
  onSessionRefreshed,
}: {
  session: Session;
  accountId: string;
  connectorSourceId?: string | null;
  onSessionRefreshed: (session: Session) => void;
}) {
  try {
    return await postAuthedJson<ConnectorSyncResponse>(
      `/v1/twins/${session.twinId}/connectors/accounts/${accountId}/sync`,
      {
        mode: "manual",
        connectorSourceId,
      },
      session,
      onSessionRefreshed,
    );
  } catch (error) {
    throw new Error(errorMessage(error));
  }
}
