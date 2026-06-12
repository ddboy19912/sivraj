import {
  deleteAuthedJson,
  getAuthedJson,
  postAuthedJson,
  putAuthedJson,
} from "@/lib/api";
import type { Session } from "@/lib/session";

export type ProviderKind =
  | "openai"
  | "openrouter"
  | "ollama"
  | "custom_openai_compatible";

export type ProviderStatus = "connected" | "disconnected" | "error";
export type ProviderAuthMethod = "openrouter_pkce" | "none";

export type SafeProviderConfig = {
  id: string | null;
  providerKind: ProviderKind;
  status: ProviderStatus;
  isActive: boolean;
  authMethod: ProviderAuthMethod;
  displayName: string;
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
  lastTestedAt: string | null;
  updatedAt: string | null;
};

export type ProviderConfigResponse = {
  config: SafeProviderConfig | null;
  activeConfig: SafeProviderConfig | null;
  configs: SafeProviderConfig[];
  fallback: {
    providerKind: string;
    displayName: string;
    baseUrl: string;
    model: string;
    source: "env";
  } | null;
};

export type ChatThread = {
  id: string;
  title: string;
  llmProviderConfigId: string | null;
  metadata: unknown;
  createdAt: string;
  updatedAt: string;
};

export type ChatMessage = {
  id: string;
  threadId: string;
  role: "system" | "user" | "assistant";
  content: string;
  providerKind: ProviderKind | null;
  model: string | null;
  memoryFragmentIds: string[];
  citations: Array<{
    id: string;
    label: string;
    sourceArtifactId: string;
    score: number;
    matchedTerms: string[];
  }> | null;
  usage: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
};

type SendMessageResponse = {
  userMessage: ChatMessage;
  assistantMessage: ChatMessage;
  context: {
    citations: NonNullable<ChatMessage["citations"]>;
    memoryCount: number;
    tokenContextSaved: number;
    policy: {
      rawArtifactsIncluded: boolean;
      memory: string;
    };
  };
};

type SessionHandler = (session: Session) => void;

export function loadProviderConfig(
  session: Session,
  onSessionRefreshed: SessionHandler,
) {
  return getAuthedJson<ProviderConfigResponse>(
    `/v1/twins/${session.twinId}/chat/provider-config`,
    session,
    onSessionRefreshed,
  );
}

export function startOpenRouterOAuth(
  callbackUrl: string,
  session: Session,
  onSessionRefreshed: SessionHandler,
) {
  return postAuthedJson<{
    authUrl: string;
    codeVerifier: string;
    state: string;
  }>(
    `/v1/twins/${session.twinId}/chat/provider-config/openrouter/oauth/start`,
    { callbackUrl },
    session,
    onSessionRefreshed,
  );
}

export function completeOpenRouterOAuth(
  input: {
    code: string;
    state: string;
    codeVerifier: string;
  },
  session: Session,
  onSessionRefreshed: SessionHandler,
) {
  return postAuthedJson<ProviderConfigResponse>(
    `/v1/twins/${session.twinId}/chat/provider-config/openrouter/oauth/callback`,
    input,
    session,
    onSessionRefreshed,
  );
}

export function createOpenRouterModelConfig(
  input: { displayName: string; model: string },
  session: Session,
  onSessionRefreshed: SessionHandler,
) {
  return postAuthedJson<ProviderConfigResponse>(
    `/v1/twins/${session.twinId}/chat/provider-config/openrouter/models`,
    input,
    session,
    onSessionRefreshed,
  );
}

export function selectProviderConfig(
  providerConfigId: string,
  session: Session,
  onSessionRefreshed: SessionHandler,
) {
  return putAuthedJson<ProviderConfigResponse>(
    `/v1/twins/${session.twinId}/chat/provider-config/${providerConfigId}/select`,
    {},
    session,
    onSessionRefreshed,
  );
}

export function selectFallbackProviderConfig(
  session: Session,
  onSessionRefreshed: SessionHandler,
) {
  return putAuthedJson<ProviderConfigResponse>(
    `/v1/twins/${session.twinId}/chat/provider-config/default/select`,
    {},
    session,
    onSessionRefreshed,
  );
}

export function updateProviderConfigModel(
  providerConfigId: string,
  input: {
    displayName: string;
    model: string;
  },
  session: Session,
  onSessionRefreshed: SessionHandler,
) {
  return putAuthedJson<ProviderConfigResponse>(
    `/v1/twins/${session.twinId}/chat/provider-config/${providerConfigId}/model`,
    input,
    session,
    onSessionRefreshed,
  );
}

export function disconnectProviderConfig(
  providerConfigId: string,
  session: Session,
  onSessionRefreshed: SessionHandler,
) {
  return deleteAuthedJson<ProviderConfigResponse>(
    `/v1/twins/${session.twinId}/chat/provider-config/${providerConfigId}`,
    session,
    onSessionRefreshed,
  );
}

export function loadThreads(
  session: Session,
  onSessionRefreshed: SessionHandler,
) {
  return getAuthedJson<{ threads: ChatThread[] }>(
    `/v1/twins/${session.twinId}/chat/threads`,
    session,
    onSessionRefreshed,
  );
}

export function createThread(
  title: string,
  session: Session,
  onSessionRefreshed: SessionHandler,
) {
  return postAuthedJson<{ thread: ChatThread }>(
    `/v1/twins/${session.twinId}/chat/threads`,
    { title },
    session,
    onSessionRefreshed,
  );
}

export function loadThreadMessages(
  threadId: string,
  session: Session,
  onSessionRefreshed: SessionHandler,
) {
  return getAuthedJson<{ thread: ChatThread; messages: ChatMessage[] }>(
    `/v1/twins/${session.twinId}/chat/threads/${threadId}/messages`,
    session,
    onSessionRefreshed,
  );
}

export function sendChatMessage(
  threadId: string,
  content: string,
  session: Session,
  onSessionRefreshed: SessionHandler,
) {
  return postAuthedJson<SendMessageResponse>(
    `/v1/twins/${session.twinId}/chat/threads/${threadId}/messages`,
    { content },
    session,
    onSessionRefreshed,
  );
}
