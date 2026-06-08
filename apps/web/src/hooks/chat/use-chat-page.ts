import { useChatMessageActions } from "@/hooks/chat/use-chat-message-actions";
import { useChatPageEffects } from "@/hooks/chat/use-chat-page-effects";
import { useChatPageState } from "@/hooks/chat/use-chat-page-state";
import { useChatThreadActions } from "@/hooks/chat/use-chat-thread-callbacks";
import type { ProviderConfigResponse } from "@/lib/chat/chat-api";
import type { Session } from "@/lib/session";

type UseChatPageInput = {
  session: Session | null;
  isSessionForWallet: boolean;
  onSessionRefreshed: (session: Session) => void;
  providerState: ProviderConfigResponse | null;
  onProviderStateChange: (state: ProviderConfigResponse | null) => void;
};

export function useChatPage(input: UseChatPageInput) {
  const pageState = useChatPageState(input.providerState);
  const canChat = Boolean(input.session && input.isSessionForWallet);
  const activeThread =
    pageState.threads.find((thread) => thread.id === pageState.activeThreadId) ?? null;

  const threadActions = useChatThreadActions({
    session: input.session,
    isSessionForWallet: input.isSessionForWallet,
    activeThreadId: pageState.activeThreadId,
    isLoading: pageState.isLoading,
    onSessionRefreshed: input.onSessionRefreshed,
    onProviderStateChange: input.onProviderStateChange,
    setThreads: pageState.setThreads,
    setActiveThreadId: pageState.setActiveThreadId,
    setMessages: pageState.setMessages,
    setIsLoading: pageState.setIsLoading,
    setNotice: pageState.setNotice,
  });

  const messageActions = useChatMessageActions({
    session: input.session,
    activeThreadId: pageState.activeThreadId,
    draft: pageState.draft,
    isSending: pageState.isSending,
    onSessionRefreshed: input.onSessionRefreshed,
    setDraft: pageState.setDraft,
    setMessages: pageState.setMessages,
    setThreads: pageState.setThreads,
    setActiveThreadId: pageState.setActiveThreadId,
    setIsSending: pageState.setIsSending,
    setNotice: pageState.setNotice,
  });

  useChatPageEffects({
    refreshChatState: threadActions.refreshChatState,
    refreshKey: `${input.isSessionForWallet}:${input.session?.twinId ?? ""}`,
    messages: pageState.messages,
    isSending: pageState.isSending,
    messagesEndRef: pageState.messagesEndRef,
  });

  return {
    activeThread,
    activeThreadId: pageState.activeThreadId,
    canChat,
    draft: pageState.draft,
    handleComposerKeyDown: messageActions.handleComposerKeyDown,
    isLoading: pageState.isLoading,
    isSending: pageState.isSending,
    messages: pageState.messages,
    messagesEndRef: pageState.messagesEndRef,
    notice: pageState.notice,
    providerPresentation: pageState.providerPresentation,
    sendMessage: messageActions.sendMessage,
    setDraft: pageState.setDraft,
    startNewThread: threadActions.startNewThread,
    switchThread: threadActions.switchThread,
    threads: pageState.threads,
  };
}
