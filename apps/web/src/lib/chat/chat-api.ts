import {
  deleteAuthedJson,
  getAuthedBlob,
  getAuthedJson,
  getAuthedStream,
  postAuthedJson,
  postAuthedStream,
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
  capability: RuntimeCapability;
  displayName: string;
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
  lastTestedAt: string | null;
  updatedAt: string | null;
};

export type RuntimeCapability = "chat" | "embeddings" | "speech_to_text" | "text_to_speech";
export type ChatMemoryIntent = "auto" | "remember" | "private";
export type ChatSurface = "web_chat" | "voice_chat";

export type RuntimeCapabilityConfig = {
  capability: RuntimeCapability;
  providerKind: string;
  displayName: string;
  baseUrl: string;
  model: string;
  source: "env";
  configured: boolean;
};

export type ProviderConfigResponse = {
  config: SafeProviderConfig | null;
  activeConfig: SafeProviderConfig | null;
  configs: SafeProviderConfig[];
  runtimeDefaults?: Record<RuntimeCapability, RuntimeCapabilityConfig>;
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
  turnId: string | null;
  role: "system" | "user" | "assistant";
  status: "pending" | "streaming" | "completed" | "failed" | "cancelled";
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

export type ChatMessageAttachment = {
  artifactId: string;
  sourceType: string;
  fileName: string;
  fileType: string | null;
  fileSize: number | null;
  status: "pending" | "queued" | "processing" | "completed" | "failed" | "cancelled";
  intelligenceStatus?: "pending" | "queued" | "processing" | "completed" | "failed" | "cancelled" | "skipped" | null;
  processing?: Record<string, unknown> | null;
  createdAt?: string;
  updatedAt?: string;
  localPreviewUrl?: string;
};

export type TokenSavingsEstimate = {
  method: "source_vs_memory_estimate";
  estimatedTokensSaved: number;
  sourceTokensRepresented: number;
  memoryContextTokens: number;
  memoryCount: number;
  compressionRatio: number | null;
};

export type ArtifactUploadReceipt = {
  artifactId: string;
  memoryFragmentId: string | null;
  status: "pending" | "queued" | "processing" | "completed" | "failed" | "cancelled";
  storageMode: string;
  sensitivity: string;
  rawStorageRef: string;
  processingJobId?: string;
  warning?: string;
};

export type ArtifactStatusEvent = {
  type: "artifact.status";
  artifactId: string;
  twinId: string;
  sourceType: string;
  status: "pending" | "queued" | "processing" | "completed" | "failed" | "cancelled";
  intelligenceStatus?: "pending" | "queued" | "processing" | "completed" | "failed" | "cancelled" | "skipped" | null;
  reason?: string | null;
  processing?: Record<string, unknown> | null;
  occurredAt: string;
};

export type ChatTurn = {
  id: string;
  threadId: string;
  userMessageId: string | null;
  assistantMessageId: string | null;
  status: "queued" | "retrieving_context" | "generating" | "completed" | "failed" | "cancelled";
  providerKind: ProviderKind | null;
  model: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
};

export type ChatTurnStreamEvent =
  | {
      type: "turn.created";
      turn: ChatTurn;
      userMessage: ChatMessage;
      assistantMessage: ChatMessage;
    }
  | {
      type: "context.ready";
      turnId: string;
      memoryCount: number;
      citations: NonNullable<ChatMessage["citations"]>;
      tokenContextSaved: number;
      tokenSavings?: TokenSavingsEstimate;
      timings?: Record<string, number>;
    }
  | {
      type: "assistant.delta";
      turnId: string;
      assistantMessageId: string;
      delta: string;
    }
  | {
      type: "assistant.completed";
      turnId: string;
      assistantMessage: ChatMessage;
      context: SendMessageResponse["context"];
    }
  | {
      type: "turn.failed";
      turnId: string;
      assistantMessageId?: string;
      error: {
        code: string;
        message: string;
        retryable?: boolean;
        retryAttempt?: number;
        nextRetryAttempt?: number;
        timeoutMs?: number;
        nextTimeoutMs?: number;
      };
    }
  | {
      type: "turn.cancelled";
      turnId: string;
    };

type SendMessageResponse = {
  userMessage: ChatMessage;
  assistantMessage: ChatMessage;
  context: {
    citations: NonNullable<ChatMessage["citations"]>;
    memoryCount: number;
    tokenContextSaved: number;
    tokenSavings?: TokenSavingsEstimate;
    timings?: Record<string, number>;
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
  input: { displayName: string; model: string; capability: RuntimeCapability },
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
  capability: RuntimeCapability,
  session: Session,
  onSessionRefreshed: SessionHandler,
) {
  return putAuthedJson<ProviderConfigResponse>(
    `/v1/twins/${session.twinId}/chat/provider-config/default/select`,
    { capability },
    session,
    onSessionRefreshed,
  );
}

export function updateProviderConfigModel(
  providerConfigId: string,
  input: {
    displayName: string;
    model: string;
    capability: RuntimeCapability;
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
  surface: ChatSurface = "web_chat",
) {
  return postAuthedJson<{ thread: ChatThread }>(
    `/v1/twins/${session.twinId}/chat/threads`,
    { title, surface },
    session,
    onSessionRefreshed,
  );
}

export function deleteThread(
  threadId: string,
  session: Session,
  onSessionRefreshed: SessionHandler,
) {
  return deleteAuthedJson<{ threads: ChatThread[] }>(
    `/v1/twins/${session.twinId}/chat/threads/${threadId}`,
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
  memoryIntent: ChatMemoryIntent = "auto",
) {
  return postAuthedJson<SendMessageResponse>(
    `/v1/twins/${session.twinId}/chat/threads/${threadId}/messages`,
    { content, memoryIntent },
    session,
    onSessionRefreshed,
  );
}

export function uploadArtifact(
  body: Record<string, unknown>,
  session: Session,
  onSessionRefreshed: SessionHandler,
) {
  return postAuthedJson<ArtifactUploadReceipt>(
    `/v1/twins/${session.twinId}/artifacts`,
    body,
    session,
    onSessionRefreshed,
  );
}

export function createThreadAttachmentMessage(
  input: {
    threadId: string;
    artifactId: string;
    fileName: string;
    fileType: string | null;
    fileSize: number | null;
  },
  session: Session,
  onSessionRefreshed: SessionHandler,
) {
  return postAuthedJson<{ message: ChatMessage }>(
    `/v1/twins/${session.twinId}/chat/threads/${input.threadId}/attachments`,
    {
      artifactId: input.artifactId,
      fileName: input.fileName,
      fileType: input.fileType,
      fileSize: input.fileSize,
    },
    session,
    onSessionRefreshed,
  );
}

export async function streamArtifactStatus(
  input: {
    artifactId: string;
    session: Session;
    onSessionRefreshed: SessionHandler;
    signal?: AbortSignal;
    onEvent: (event: ArtifactStatusEvent) => void;
  },
) {
  const response = await getAuthedStream(
    `/v1/twins/${input.session.twinId}/artifacts/${input.artifactId}/events`,
    input.session,
    input.onSessionRefreshed,
    input.signal,
  );

  await readSseStream(response, input.onEvent, "Artifact stream did not return a readable body.");
}

export function getArtifactPreviewBlob(
  input: {
    artifactId: string;
    session: Session;
    onSessionRefreshed: SessionHandler;
  },
) {
  return getAuthedBlob(
    `/v1/twins/${input.session.twinId}/artifacts/${input.artifactId}/preview`,
    input.session,
    input.onSessionRefreshed,
  );
}

export async function streamChatTurn(
  input: {
    threadId: string;
    content: string;
    memoryIntent?: ChatMemoryIntent;
    retryAttempt?: number;
    surface?: ChatSurface;
    session: Session;
    onSessionRefreshed: SessionHandler;
    signal?: AbortSignal;
    onEvent: (event: ChatTurnStreamEvent) => void;
  },
) {
  const response = await postAuthedStream(
    `/v1/twins/${input.session.twinId}/chat/threads/${input.threadId}/turns`,
    {
      content: input.content,
      memoryIntent: input.memoryIntent ?? "auto",
      retryAttempt: input.retryAttempt ?? 0,
      surface: input.surface ?? "web_chat",
    },
    input.session,
    input.onSessionRefreshed,
    input.signal,
  );

  await readSseStream(response, input.onEvent);
}

async function readSseStream<TEvent>(
  response: Response,
  onEvent: (event: TEvent) => void,
  missingBodyMessage = "Chat stream did not return a readable body.",
) {
  if (!response.body) {
    throw new Error(missingBodyMessage);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  async function pump(): Promise<void> {
    const { done, value } = await reader.read();
    if (done) {
      return;
    }

    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split(/\n\n/u);
    buffer = frames.pop() ?? "";

    for (const frame of frames) {
      const event = parseSseFrame<TEvent>(frame);
      if (event) {
        onEvent(event);
      }
    }

    await pump();
  }

  await pump();

  const finalEvent = parseSseFrame<TEvent>(buffer);
  if (finalEvent) {
    onEvent(finalEvent);
  }
}

function parseSseFrame<TEvent>(frame: string): TEvent | null {
  const lines = frame.split(/\n/u);
  let event = "";
  const dataLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim();
      continue;
    }

    if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trim());
    }
  }

  const data = dataLines.join("\n");

  if (!event || !data) {
    return null;
  }

  return { type: event, ...JSON.parse(data) } as TEvent;
}
