import { useChatMessageActions } from "@/hooks/chat/use-chat-message-actions";
import { useChatAttachmentUpload } from "@/hooks/chat/use-chat-attachment-upload";
import { useChatPageEffects } from "@/hooks/chat/use-chat-page-effects";
import { useChatPageState } from "@/hooks/chat/use-chat-page-state";
import { useChatThreadActions } from "@/hooks/chat/use-chat-thread-callbacks";
import type { ChatMessage, ProviderConfigResponse } from "@/lib/chat/chat-api";
import { readChatMessageAttachments } from "@/lib/chat/chat-attachments";
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
    setStatus: pageState.setStatus,
    setNotice: pageState.setNotice,
    setLastFailedContent: pageState.setLastFailedContent,
  });

  const messageActions = useChatMessageActions({
    session: input.session,
    activeThreadId: pageState.activeThreadId,
    draft: pageState.draft,
    memoryIntent: pageState.memoryIntent,
    isSending: pageState.isSending,
    status: pageState.status,
    lastFailedContent: pageState.lastFailedContent,
    lastFailedMemoryIntent: pageState.lastFailedMemoryIntent,
    lastFailedRetryAttempt: pageState.lastFailedRetryAttempt,
    onSessionRefreshed: input.onSessionRefreshed,
    setDraft: pageState.setDraft,
    clearActiveDraft: pageState.clearActiveDraft,
    setMessages: pageState.setMessages,
    setThreads: pageState.setThreads,
    setActiveThreadId: pageState.setActiveThreadId,
    setStatus: pageState.setStatus,
    setNotice: pageState.setNotice,
    setLastFailedContent: pageState.setLastFailedContent,
    setLastFailedMemoryIntent: pageState.setLastFailedMemoryIntent,
    setLastFailedRetryAttempt: pageState.setLastFailedRetryAttempt,
    setMemoryIntent: pageState.setMemoryIntent,
    activeStreamAbortRef: pageState.activeStreamAbortRef,
  });

  const attachmentUpload = useChatAttachmentUpload({
    session: input.session,
    activeThreadId: pageState.activeThreadId,
    messages: pageState.messages,
    onSessionRefreshed: input.onSessionRefreshed,
    setActiveThreadId: pageState.setActiveThreadId,
    setMessages: pageState.setMessages,
    setThreads: pageState.setThreads,
    setNotice: pageState.setNotice,
  });

  useChatPageEffects({
    refreshChatState: threadActions.refreshChatState,
    refreshKey: `${input.isSessionForWallet}:${input.session?.twinId ?? ""}`,
    messages: pageState.messages,
    isSending: pageState.isSending,
    messagesEndRef: pageState.messagesEndRef,
  });

  async function saveDraftAsSource(fileName: string) {
    const content = pageState.draft;

    if (!content.trim()) {
      pageState.setNotice({ tone: "error", text: "Paste or write source content first." });
      return;
    }

    const saved = await attachmentUpload.saveSourceContent({
      content,
      fileName,
      origin: "draft",
    });
    if (saved) {
      pageState.clearActiveDraft(pageState.activeThreadId);
    }
  }

  async function saveMessageAsSource(
    content: string,
    fileName: string,
    role: "system" | "user" | "assistant",
  ) {
    await attachmentUpload.saveSourceContent({
      content,
      fileName,
      origin: role === "assistant" ? "assistant_message" : "chat_message",
    });
  }

  async function saveCodeBlockAsSource(content: string, fileName: string) {
    await attachmentUpload.saveSourceContent({
      content,
      fileName,
      origin: "code_block",
    });
  }

  return {
    activeThread,
    activeThreadId: pageState.activeThreadId,
    canChat,
    attachmentUploadStatus: attachmentUpload.attachmentUploadStatus,
    draft: pageState.draft,
    attachFiles: attachmentUpload.attachFiles,
    failedAttachmentCount: countFailedAttachments(pageState.messages),
    openAttachment: attachmentUpload.openAttachment,
    retryFailedAttachments: attachmentUpload.retryFailedAttachments,
    handleComposerKeyDown: messageActions.handleComposerKeyDown,
    isLoading: pageState.isLoading,
    isSending: pageState.isSending,
    lastFailedContent: pageState.lastFailedContent,
    memoryIntent: pageState.memoryIntent,
    messages: pageState.messages,
    messagesEndRef: pageState.messagesEndRef,
    notice: pageState.notice,
    providerPresentation: pageState.providerPresentation,
    retryLastMessage: messageActions.retryLastMessage,
    saveCodeBlockAsSource,
    saveDraftAsSource,
    saveMessageAsSource,
    sendMessage: messageActions.sendMessage,
    setDraft: pageState.setDraft,
    setMemoryIntent: pageState.setMemoryIntent,
    startNewThread: threadActions.startNewThread,
    status: pageState.status,
    stopStreaming: messageActions.stopStreaming,
    switchThread: threadActions.switchThread,
    deleteThread: threadActions.deleteThread,
    threads: pageState.threads,
  };
}

function countFailedAttachments(messages: ChatMessage[]) {
  let count = 0;

  for (const message of messages) {
    for (const attachment of readChatMessageAttachments(message)) {
      if (isFailedAttachment(attachment)) {
        count += 1;
      }
    }
  }

  return count;
}

function isFailedAttachment(attachment: ReturnType<typeof readChatMessageAttachments>[number]) {
  return !attachment.artifactId.startsWith("local-") &&
    (attachment.status === "failed" || attachment.intelligenceStatus === "failed");
}
