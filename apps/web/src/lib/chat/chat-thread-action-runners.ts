import {
  chatErrorNotice,
  createChatThread,
  deleteChatThread,
  loadChatThreadMessages,
  prependThread,
  refreshChatPageState,
} from "@/lib/chat/chat-page-actions";
import type { ChatMessage, ChatThread, ProviderConfigResponse } from "@/lib/chat/chat-api";
import type { Session } from "@/lib/session";
import type { ChatPageStatus } from "@/types/chat.types";

type Notice = {
  tone: "error" | "info";
  text: string;
} | null;

type ThreadActionSetters = {
  setThreads: React.Dispatch<React.SetStateAction<ChatThread[]>>;
  setActiveThreadId: React.Dispatch<React.SetStateAction<string | null>>;
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  setIsLoading: (value: boolean) => void;
  setStatus: React.Dispatch<React.SetStateAction<ChatPageStatus>>;
  setNotice: React.Dispatch<React.SetStateAction<Notice | null>>;
  setLastFailedContent: React.Dispatch<React.SetStateAction<string | null>>;
};

export async function runRefreshChatState({
  session,
  activeThreadId,
  onSessionRefreshed,
  onProviderStateChange,
  setters,
}: {
  session: Session;
  activeThreadId: string | null;
  onSessionRefreshed: (session: Session) => void;
  onProviderStateChange: (state: ProviderConfigResponse | null) => void;
  setters: ThreadActionSetters;
}) {
  setters.setIsLoading(true);
  setters.setStatus("booting");
  setters.setNotice(null);
  try {
    const next = await refreshChatPageState({
      session,
      activeThreadId,
      onSessionRefreshed,
      onProviderStateChange,
    });
    setters.setThreads(next.threads);
    setters.setActiveThreadId(next.activeThreadId);
    setters.setMessages(next.messages);
    setters.setLastFailedContent(null);
    setters.setStatus("ready");
  } catch (error) {
    setters.setNotice(chatErrorNotice(error, "Could not load chat."));
    setters.setStatus("failed");
  } finally {
    setters.setIsLoading(false);
  }
}

export async function runSwitchChatThread({
  session,
  threadId,
  onSessionRefreshed,
  setters,
}: {
  session: Session;
  threadId: string;
  onSessionRefreshed: (session: Session) => void;
  setters: ThreadActionSetters;
}) {
  setters.setActiveThreadId(threadId);
  setters.setIsLoading(true);
  setters.setStatus("booting");
  setters.setNotice(null);
  try {
    setters.setMessages(
      await loadChatThreadMessages(threadId, session, onSessionRefreshed),
    );
    setters.setLastFailedContent(null);
    setters.setStatus("ready");
  } catch (error) {
    setters.setNotice(chatErrorNotice(error, "Could not load thread."));
    setters.setStatus("failed");
  } finally {
    setters.setIsLoading(false);
  }
}

export async function runCreateChatThread({
  session,
  onSessionRefreshed,
  setters,
}: {
  session: Session;
  onSessionRefreshed: (session: Session) => void;
  setters: ThreadActionSetters;
}) {
  setters.setIsLoading(true);
  setters.setStatus("booting");
  setters.setNotice(null);
  try {
    const thread = await createChatThread(session, onSessionRefreshed);
    setters.setThreads((current) => prependThread(current, thread));
    setters.setActiveThreadId(thread.id);
    setters.setMessages([]);
    setters.setLastFailedContent(null);
    setters.setStatus("ready");
  } catch (error) {
    setters.setNotice(chatErrorNotice(error, "Could not create chat."));
    setters.setStatus("failed");
  } finally {
    setters.setIsLoading(false);
  }
}

export async function runDeleteChatThread({
  session,
  activeThreadId,
  threadId,
  onSessionRefreshed,
  setters,
}: {
  session: Session;
  activeThreadId: string | null;
  threadId: string;
  onSessionRefreshed: (session: Session) => void;
  setters: ThreadActionSetters;
}) {
  setters.setIsLoading(true);
  setters.setStatus("booting");
  setters.setNotice(null);
  try {
    const response = await deleteChatThread(threadId, session, onSessionRefreshed);
    const nextActiveThreadId =
      activeThreadId === threadId ? response.threads[0]?.id ?? null : activeThreadId;
    setters.setThreads(response.threads);
    setters.setActiveThreadId(nextActiveThreadId);
    setters.setMessages(
      nextActiveThreadId
        ? await loadChatThreadMessages(nextActiveThreadId, session, onSessionRefreshed)
        : [],
    );
    setters.setLastFailedContent(null);
    setters.setStatus("ready");
  } catch (error) {
    setters.setNotice(chatErrorNotice(error, "Could not delete chat."));
    setters.setStatus("failed");
  } finally {
    setters.setIsLoading(false);
  }
}
