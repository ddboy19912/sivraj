import {
  chatErrorNotice,
  replaceOptimisticMessages,
  sendChatPageMessage,
} from "@/lib/chat/chat-page-actions";
import { createOptimisticUserMessage } from "@/lib/chat/chat-formatters";
import type { ChatMessage } from "@/lib/chat/chat-api";
import type { Session } from "@/lib/session";

type Notice = {
  tone: "error" | "info";
  text: string;
} | null;

type ChatMessageActionsInput = {
  session: Session | null;
  activeThreadId: string | null;
  draft: string;
  isSending: boolean;
  onSessionRefreshed: (session: Session) => void;
  setDraft: React.Dispatch<React.SetStateAction<string>>;
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  setThreads: React.Dispatch<React.SetStateAction<import("@/lib/chat/chat-api").ChatThread[]>>;
  setActiveThreadId: React.Dispatch<React.SetStateAction<string | null>>;
  setIsSending: React.Dispatch<React.SetStateAction<boolean>>;
  setNotice: React.Dispatch<React.SetStateAction<Notice | null>>;
};

export function useChatMessageActions(input: ChatMessageActionsInput) {
  async function sendMessage() {
    if (!input.session || input.isSending) {
      return;
    }

    const content = input.draft.trim();
    if (!content) {
      return;
    }

    input.setIsSending(true);
    input.setNotice(null);
    input.setDraft("");
    const optimistic = createOptimisticUserMessage(
      input.activeThreadId,
      content,
    );
    input.setMessages((current) => [...current, optimistic]);

    try {
      const result = await sendChatPageMessage({
        session: input.session,
        activeThreadId: input.activeThreadId,
        content,
        onSessionRefreshed: input.onSessionRefreshed,
      });
      if (!input.activeThreadId) {
        input.setActiveThreadId(result.threadId);
      }
      input.setMessages((current) =>
        replaceOptimisticMessages(current, optimistic.id, result.messages),
      );
      input.setThreads(result.threads);
      input.setIsSending(false);
    } catch (error) {
      input.setDraft(content);
      input.setMessages((current) =>
        current.filter((message) => message.id !== optimistic.id),
      );
      input.setNotice(chatErrorNotice(error, "Message failed."));
      input.setIsSending(false);
    }
  }

  function handleComposerKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  }

  return {
    handleComposerKeyDown,
    sendMessage,
  };
}
