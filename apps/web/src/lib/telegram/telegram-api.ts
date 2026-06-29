import {
  getAuthedJson,
  postAuthedJson,
  type Session,
} from "@/lib/api";
import type {
  TelegramConnectionResponse,
  TelegramLinkTokenResponse,
  TelegramRevokeResponse,
} from "@/types/telegram.types";

export function loadTelegramConnection(
  session: Session,
  onSessionRefreshed: (session: Session) => void,
) {
  return getAuthedJson<TelegramConnectionResponse>(
    `/v1/twins/${session.twinId}/integrations/telegram`,
    session,
    onSessionRefreshed,
  );
}

export function createTelegramLinkToken(
  session: Session,
  onSessionRefreshed: (session: Session) => void,
) {
  return postAuthedJson<TelegramLinkTokenResponse>(
    `/v1/twins/${session.twinId}/integrations/telegram/link-token`,
    {},
    session,
    onSessionRefreshed,
  );
}

export function revokeTelegramConnection(
  session: Session,
  onSessionRefreshed: (session: Session) => void,
) {
  return postAuthedJson<TelegramRevokeResponse>(
    `/v1/twins/${session.twinId}/integrations/telegram/revoke`,
    {},
    session,
    onSessionRefreshed,
  );
}
