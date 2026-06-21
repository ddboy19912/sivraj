import { Loader2 } from "lucide-react";
import { useEffect } from "react";
import { toast } from "sonner";
import {
  AssistantTypingIndicator,
  MessageBubble,
} from "@/components/chat/chat-message-bubble";
import { ChatMessagesEmptyState } from "@/components/chat/chat-messages-empty-state";
import type { ChatMessage, ChatMessageAttachment } from "@/lib/chat/chat-api";
import type { ChatPageStatus } from "@/types/chat.types";

type Notice = {
  tone: "error" | "info";
  text: string;
} | null;

export function ChatMessagesViewport({
  status,
  notice,
  isLoading,
  isSending,
  messages,
  messagesEndRef,
  onOpenAttachment,
  onSaveMessageAsSource,
  onSaveCodeBlockAsSource,
}: {
  status: ChatPageStatus;
  notice: Notice;
  isLoading: boolean;
  isSending: boolean;
  messages: ChatMessage[];
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
  onOpenAttachment: (attachment: ChatMessageAttachment) => void;
  onSaveMessageAsSource: (
    content: string,
    fileName: string,
    role: ChatMessage["role"],
  ) => void;
  onSaveCodeBlockAsSource: (content: string, fileName: string) => void;
}) {
  useErrorNoticeToast(notice);

  return (
    <div className="relative z-1 flex-1 overflow-y-auto px-5 py-5 max-sm:px-4">
      {isLoading ? (
        <div className="grid h-full place-items-center text-white/48">
          <Loader2 className="size-6 animate-spin" />
        </div>
      ) : messages.length === 0 ? (
        <div className="grid h-full place-items-center">
          <ChatMessagesEmptyState />
        </div>
      ) : (
        <ChatMessageList
          messages={messages}
          status={status}
          isSending={isSending}
          messagesEndRef={messagesEndRef}
          onOpenAttachment={onOpenAttachment}
          onSaveMessageAsSource={onSaveMessageAsSource}
          onSaveCodeBlockAsSource={onSaveCodeBlockAsSource}
        />
      )}
    </div>
  );
}

function useErrorNoticeToast(notice: Notice) {
  useEffect(() => {
    if (notice?.tone !== "error") {
      return;
    }

    toast.error(notice.text);
  }, [notice]);
}

function ChatMessageList({
  messages,
  status,
  isSending,
  messagesEndRef,
  onOpenAttachment,
  onSaveMessageAsSource,
  onSaveCodeBlockAsSource,
}: {
  messages: ChatMessage[];
  status: ChatPageStatus;
  isSending: boolean;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
  onOpenAttachment: (attachment: ChatMessageAttachment) => void;
  onSaveMessageAsSource: (
    content: string,
    fileName: string,
    role: ChatMessage["role"],
  ) => void;
  onSaveCodeBlockAsSource: (content: string, fileName: string) => void;
}) {
  const showPendingAssistant =
    isSending &&
    status !== "streaming" &&
    !messages.some(
      (message) =>
        message.role === "assistant" &&
        message.content.trim().length === 0 &&
        (message.status === "pending" || message.status === "streaming"),
    );

  return (
    <div className="mx-auto flex max-w-[820px] flex-col gap-7">
      {messages.map((message) => (
        <MessageBubble
          key={message.id}
          message={message}
          onOpenAttachment={onOpenAttachment}
          onSaveAsSource={onSaveMessageAsSource}
          onSaveCodeBlockAsSource={onSaveCodeBlockAsSource}
        />
      ))}
      {showPendingAssistant ? <AssistantTypingIndicator /> : null}
      <div ref={messagesEndRef} />
    </div>
  );
}
