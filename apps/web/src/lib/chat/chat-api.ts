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

export type SafeProviderConfig = {
  id: string | null;
  providerKind: ProviderKind;
  status: ProviderStatus;
  displayName: string;
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
  lastTestedAt: string | null;
  updatedAt: string | null;
};

export type ProviderConfigResponse = {
  config: SafeProviderConfig | null;
  fallback: {
    providerKind: string;
    displayName: string;
    baseUrl: string;
    model: string;
    source: "env";
  } | null;
};

export type ProviderConfigInput = {
  providerKind: ProviderKind;
  displayName?: string;
  baseUrl?: string;
  model?: string;
  apiKey?: string;
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

export function saveProviderConfig(
  input: ProviderConfigInput,
  session: Session,
  onSessionRefreshed: SessionHandler,
) {
  return putAuthedJson<{ config: SafeProviderConfig }>(
    `/v1/twins/${session.twinId}/chat/provider-config`,
    input,
    session,
    onSessionRefreshed,
  );
}

export function testProviderConfig(
  input: ProviderConfigInput,
  session: Session,
  onSessionRefreshed: SessionHandler,
) {
  return postAuthedJson<{
    ok: boolean;
    providerKind: string;
    model: string;
    sample: string;
  }>(
    `/v1/twins/${session.twinId}/chat/provider-config/test`,
    input,
    session,
    onSessionRefreshed,
  );
}

export function disconnectProviderConfig(
  session: Session,
  onSessionRefreshed: SessionHandler,
) {
  return deleteAuthedJson<{ ok: boolean }>(
    `/v1/twins/${session.twinId}/chat/provider-config`,
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
