import {
  chatErrorNotice,
  createChatThread,
  loadChatThreadMessages,
  prependThread,
  refreshChatPageState,
} from "@/lib/chat/chat-page-actions";
import type { ChatMessage, ChatThread, ProviderConfigResponse } from "@/lib/chat/chat-api";
import type { Session } from "@/lib/session";

type Notice = {
  tone: "error" | "info";
  text: string;
} | null;

type ThreadActionSetters = {
  setThreads: React.Dispatch<React.SetStateAction<ChatThread[]>>;
  setActiveThreadId: React.Dispatch<React.SetStateAction<string | null>>;
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  setIsLoading: (value: boolean) => void;
  setNotice: React.Dispatch<React.SetStateAction<Notice | null>>;
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
  } catch (error) {
    setters.setNotice(chatErrorNotice(error, "Could not load chat."));
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
  setters.setNotice(null);
  try {
    setters.setMessages(
      await loadChatThreadMessages(threadId, session, onSessionRefreshed),
    );
  } catch (error) {
    setters.setNotice(chatErrorNotice(error, "Could not load thread."));
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
  setters.setNotice(null);
  try {
    const thread = await createChatThread(session, onSessionRefreshed);
    setters.setThreads((current) => prependThread(current, thread));
    setters.setActiveThreadId(thread.id);
    setters.setMessages([]);
  } catch (error) {
    setters.setNotice(chatErrorNotice(error, "Could not create chat."));
  } finally {
    setters.setIsLoading(false);
  }
}
