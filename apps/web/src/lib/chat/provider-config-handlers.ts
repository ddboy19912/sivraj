import {
  completeOpenRouterOAuth,
  createOpenRouterModelConfig,
  disconnectProviderConfig,
  selectFallbackProviderConfig,
  selectProviderConfig,
  startOpenRouterOAuth,
  updateProviderConfigModel,
  type ProviderConfigResponse,
} from "@/lib/chat/chat-api";
import type { Session } from "@/lib/session";

const OPENROUTER_OAUTH_STORAGE_KEY = "sivraj.openrouter.oauth";

type StoredOpenRouterOAuth = {
  state: string;
  codeVerifier: string;
};

export async function beginOpenRouterOAuth(
  session: Session,
  onSessionRefreshed: (session: Session) => void,
) {
  const callbackUrl = `${window.location.origin}${window.location.pathname}`;
  const response = await startOpenRouterOAuth(callbackUrl, session, onSessionRefreshed);

  writeStoredOpenRouterOAuth({
    state: response.state,
    codeVerifier: response.codeVerifier,
  });
  window.location.assign(response.authUrl);
}

export async function completeStoredOpenRouterOAuth(
  session: Session,
  onSessionRefreshed: (session: Session) => void,
): Promise<ProviderConfigResponse | null> {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  const state = params.get("state");
  const stored = readStoredOpenRouterOAuth();

  if (!code || !state || !stored || stored.state !== state) {
    return null;
  }

  const response = await completeOpenRouterOAuth(
    {
      code,
      state,
      codeVerifier: stored.codeVerifier,
    },
    session,
    onSessionRefreshed,
  );

  clearStoredOpenRouterOAuth();
  removeOpenRouterOAuthQueryParams();

  return response;
}

export function hasPendingOpenRouterOAuthCallback() {
  const params = new URLSearchParams(window.location.search);

  return Boolean(params.get("code") && params.get("state") && readStoredOpenRouterOAuth());
}

export function selectSavedProviderConfig(
  providerConfigId: string,
  session: Session,
  onSessionRefreshed: (session: Session) => void,
) {
  return selectProviderConfig(providerConfigId, session, onSessionRefreshed);
}

export function createSavedOpenRouterModelConfig(
  input: { displayName: string; model: string },
  session: Session,
  onSessionRefreshed: (session: Session) => void,
) {
  return createOpenRouterModelConfig(input, session, onSessionRefreshed);
}

export function selectDefaultProviderConfig(
  session: Session,
  onSessionRefreshed: (session: Session) => void,
) {
  return selectFallbackProviderConfig(session, onSessionRefreshed);
}

export function deleteSavedProviderConfig(
  providerConfigId: string,
  session: Session,
  onSessionRefreshed: (session: Session) => void,
) {
  return disconnectProviderConfig(providerConfigId, session, onSessionRefreshed);
}

export function updateSavedProviderModel(
  providerConfigId: string,
  input: {
    displayName: string;
    model: string;
  },
  session: Session,
  onSessionRefreshed: (session: Session) => void,
) {
  return updateProviderConfigModel(providerConfigId, input, session, onSessionRefreshed);
}

function writeStoredOpenRouterOAuth(value: StoredOpenRouterOAuth) {
  window.sessionStorage.setItem(OPENROUTER_OAUTH_STORAGE_KEY, JSON.stringify(value));
}

function readStoredOpenRouterOAuth(): StoredOpenRouterOAuth | null {
  const raw = window.sessionStorage.getItem(OPENROUTER_OAUTH_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<StoredOpenRouterOAuth>;

    return typeof parsed.state === "string" && typeof parsed.codeVerifier === "string"
      ? { state: parsed.state, codeVerifier: parsed.codeVerifier }
      : null;
  } catch {
    return null;
  }
}

function clearStoredOpenRouterOAuth() {
  window.sessionStorage.removeItem(OPENROUTER_OAUTH_STORAGE_KEY);
}

function removeOpenRouterOAuthQueryParams() {
  const url = new URL(window.location.href);
  url.searchParams.delete("code");
  url.searchParams.delete("state");
  window.history.replaceState({}, "", url.toString());
}
