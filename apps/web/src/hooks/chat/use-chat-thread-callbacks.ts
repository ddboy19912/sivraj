import {
  runCreateChatThread,
  runDeleteChatThread,
  runRefreshChatState,
  runSwitchChatThread,
} from "@/lib/chat/chat-thread-action-runners";
import type { ChatMessage, ChatThread, ProviderConfigResponse } from "@/lib/chat/chat-api";
import type { Session } from "@/lib/session";
import type { ChatPageStatus } from "@/types/chat.types";

type Notice = {
  tone: "error" | "info";
  text: string;
} | null;

type ChatThreadCallbacksInput = {
  session: Session | null;
  isSessionForWallet: boolean;
  activeThreadId: string | null;
  isLoading: boolean;
  onSessionRefreshed: (session: Session) => void;
  onProviderStateChange: (state: ProviderConfigResponse | null) => void;
  setThreads: React.Dispatch<React.SetStateAction<ChatThread[]>>;
  setActiveThreadId: React.Dispatch<React.SetStateAction<string | null>>;
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  setIsLoading: (value: boolean) => void;
  setStatus: React.Dispatch<React.SetStateAction<ChatPageStatus>>;
  setNotice: React.Dispatch<React.SetStateAction<Notice | null>>;
  setLastFailedContent: React.Dispatch<React.SetStateAction<string | null>>;
};

export function useChatThreadActions(input: ChatThreadCallbacksInput) {
  const setters = {
    setThreads: input.setThreads,
    setActiveThreadId: input.setActiveThreadId,
    setMessages: input.setMessages,
    setIsLoading: input.setIsLoading,
    setStatus: input.setStatus,
    setNotice: input.setNotice,
    setLastFailedContent: input.setLastFailedContent,
  };

  async function refreshChatState() {
    if (!input.session || !input.isSessionForWallet) {
      input.setThreads([]);
      input.setMessages([]);
      input.setActiveThreadId(null);
      input.setStatus("ready");
      return;
    }

    await runRefreshChatState({
      session: input.session,
      activeThreadId: input.activeThreadId,
      onSessionRefreshed: input.onSessionRefreshed,
      onProviderStateChange: input.onProviderStateChange,
      setters,
    });
  }

  async function switchThread(threadId: string) {
    if (!input.session || threadId === input.activeThreadId) {
      return;
    }

    await runSwitchChatThread({
      session: input.session,
      threadId,
      onSessionRefreshed: input.onSessionRefreshed,
      setters,
    });
  }

  async function startNewThread() {
    if (!input.session || input.isLoading) {
      return;
    }

    await runCreateChatThread({
      session: input.session,
      onSessionRefreshed: input.onSessionRefreshed,
      setters,
    });
  }

  async function deleteThread(threadId: string) {
    if (!input.session || input.isLoading) {
      return;
    }

    await runDeleteChatThread({
      session: input.session,
      activeThreadId: input.activeThreadId,
      threadId,
      onSessionRefreshed: input.onSessionRefreshed,
      setters,
    });
  }

  return { deleteThread, refreshChatState, startNewThread, switchThread };
}
