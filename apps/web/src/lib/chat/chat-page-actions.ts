import { titleFromMessage } from "@/lib/chat/chat-formatters";
import {
  createThread,
  deleteThread,
  loadProviderConfig,
  loadThreadMessages,
  loadThreads,
  streamChatTurn,
  type ChatMessage,
  type ChatMemoryIntent,
  type ChatTurnStreamEvent,
  type ChatThread,
  type ProviderConfigResponse,
} from "@/lib/chat/chat-api";
import type { Session } from "@/lib/session";

type ChatNotice = {
  tone: "error" | "info";
  text: string;
} | null;

export async function refreshChatPageState({
  session,
  activeThreadId,
  onSessionRefreshed,
  onProviderStateChange,
}: {
  session: Session;
  activeThreadId: string | null;
  onSessionRefreshed: (session: Session) => void;
  onProviderStateChange: (state: ProviderConfigResponse | null) => void;
}) {
  const [providerResponse, threadResponse] = await Promise.all([
    loadProviderConfig(session, onSessionRefreshed),
    loadThreads(session, onSessionRefreshed),
  ]);
  onProviderStateChange(providerResponse);
  const nextThreadId = activeThreadId ?? threadResponse.threads[0]?.id ?? null;
  const messages = nextThreadId
    ? (
        await loadThreadMessages(nextThreadId, session, onSessionRefreshed)
      ).messages
    : [];

  return {
    threads: threadResponse.threads,
    activeThreadId: nextThreadId,
    messages,
  };
}

export async function loadChatThreadMessages(
  threadId: string,
  session: Session,
  onSessionRefreshed: (session: Session) => void,
) {
  const response = await loadThreadMessages(threadId, session, onSessionRefreshed);
  return response.messages;
}

export async function createChatThread(
  session: Session,
  onSessionRefreshed: (session: Session) => void,
  title = "New chat",
) {
  const response = await createThread(title, session, onSessionRefreshed);
  return response.thread;
}

export function deleteChatThread(
  threadId: string,
  session: Session,
  onSessionRefreshed: (session: Session) => void,
) {
  return deleteThread(threadId, session, onSessionRefreshed);
}

export async function sendStreamingChatPageMessage({
  session,
  activeThreadId,
  content,
  memoryIntent,
  retryAttempt = 0,
  onSessionRefreshed,
  signal,
  onEvent,
}: {
  session: Session;
  activeThreadId: string | null;
  content: string;
  memoryIntent: ChatMemoryIntent;
  retryAttempt?: number;
  onSessionRefreshed: (session: Session) => void;
  signal?: AbortSignal;
  onEvent: (event: ChatTurnStreamEvent) => void;
}) {
  const threadId =
    activeThreadId ??
    (await createThread(titleFromMessage(content), session, onSessionRefreshed))
      .thread.id;

  await streamChatTurn({
    threadId,
    content,
    memoryIntent,
    retryAttempt,
    session,
    onSessionRefreshed,
    signal,
    onEvent,
  });

  const threadResponse = await loadThreads(session, onSessionRefreshed);

  return {
    threadId,
    threads: threadResponse.threads,
  };
}

export function chatErrorNotice(error: unknown, fallback: string): ChatNotice {
  return {
    tone: "error",
    text: error instanceof Error ? error.message : fallback,
  };
}

export function prependThread(
  threads: ChatThread[],
  thread: ChatThread,
): ChatThread[] {
  return [thread, ...threads];
}

export function replaceOptimisticMessages(
  current: ChatMessage[],
  optimisticId: string,
  nextMessages: ChatMessage[],
) {
  return [
    ...current.filter((message) => message.id !== optimisticId),
    ...nextMessages,
  ];
}
