import {
  createOptimisticUserMessage,
  titleFromMessage,
} from "@/lib/chat/chat-formatters";
import {
  createThread,
  loadProviderConfig,
  loadThreadMessages,
  loadThreads,
  sendChatMessage,
  type ChatMessage,
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

export async function sendChatPageMessage({
  session,
  activeThreadId,
  content,
  onSessionRefreshed,
}: {
  session: Session;
  activeThreadId: string | null;
  content: string;
  onSessionRefreshed: (session: Session) => void;
}) {
  const optimistic = createOptimisticUserMessage(activeThreadId, content);
  const threadId =
    activeThreadId ??
    (await createThread(titleFromMessage(content), session, onSessionRefreshed))
      .thread.id;
  const responsePromise = sendChatMessage(
    threadId,
    content,
    session,
    onSessionRefreshed,
  );
  const threadResponsePromise = responsePromise.then(() =>
    loadThreads(session, onSessionRefreshed),
  );
  const [response, threadResponse] = await Promise.all([
    responsePromise,
    threadResponsePromise,
  ]);

  return {
    optimisticId: optimistic.id,
    threadId,
    messages: [response.userMessage, response.assistantMessage],
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
