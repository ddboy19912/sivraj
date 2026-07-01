import type {
  TelegramConnectionResponse,
  TelegramLinkTokenResponse,
} from "@/types/telegram.types";

export type TelegramIntegrationStatus =
  | "idle"
  | "loading"
  | "creating_link"
  | "revoking"
  | "failed";

export type TelegramIntegrationState = {
  connection: TelegramConnectionResponse | null;
  latestLink: TelegramLinkTokenResponse | null;
  loadedTwinId: string | null;
  status: TelegramIntegrationStatus;
  notice: string | null;
};

export type TelegramIntegrationAction =
  | { type: "LOAD_STARTED"; twinId: string }
  | {
      type: "LOAD_SUCCEEDED";
      twinId: string;
      connection: TelegramConnectionResponse;
    }
  | { type: "LOAD_FAILED"; error: string }
  | { type: "CREATING_LINK" }
  | { type: "LINK_CREATED"; link: TelegramLinkTokenResponse }
  | { type: "REVOKING" }
  | { type: "REVOKED" }
  | { type: "ACTION_FAILED"; error: string };

export const initialTelegramIntegrationState: TelegramIntegrationState = {
  connection: null,
  latestLink: null,
  loadedTwinId: null,
  status: "idle",
  notice: null,
};

export function telegramIntegrationReducer(
  state: TelegramIntegrationState,
  action: TelegramIntegrationAction,
): TelegramIntegrationState {
  switch (action.type) {
    case "LOAD_STARTED":
      return {
        ...state,
        loadedTwinId: action.twinId,
        status: "loading",
        notice: null,
      };
    case "LOAD_SUCCEEDED":
      return {
        ...state,
        connection: action.connection,
        loadedTwinId: action.twinId,
        status: "idle",
        notice: null,
      };
    case "LOAD_FAILED":
      return { ...state, status: "failed", notice: action.error };
    case "CREATING_LINK":
      return { ...state, status: "creating_link", notice: null };
    case "LINK_CREATED":
      return {
        ...state,
        latestLink: action.link,
        connection: state.connection
          ? {
              ...state.connection,
              status: action.link.status,
              botUsername: action.link.botUsername,
              pendingLink: {
                id: action.link.tokenId,
                expiresAt: action.link.expiresAt,
              },
            }
          : state.connection,
        status: "idle",
      };
    case "REVOKING":
      return { ...state, status: "revoking", notice: null };
    case "REVOKED":
      return {
        ...state,
        latestLink: null,
        connection: state.connection
          ? {
              ...state.connection,
              status: "revoked",
              pendingLink: null,
              account: state.connection.account
                ? { ...state.connection.account, status: "disconnected" }
                : null,
            }
          : state.connection,
        status: "idle",
      };
    case "ACTION_FAILED":
      return { ...state, status: "failed", notice: action.error };
  }
}
