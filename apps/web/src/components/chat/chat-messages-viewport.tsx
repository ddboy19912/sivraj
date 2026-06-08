import { Loader2 } from "lucide-react";
import { ChatMessagesEmptyState } from "@/components/chat/chat-messages-empty-state";
import { MessageBubble } from "@/components/chat/chat-message-bubble";
import { cn } from "@/lib/ui/utils";
import type { ChatMessage } from "@/lib/chat/chat-api";

type Notice = {
  tone: "error" | "info";
  text: string;
} | null;

export function ChatMessagesViewport({
  notice,
  isLoading,
  isSending,
  messages,
  messagesEndRef,
}: {
  notice: Notice;
  isLoading: boolean;
  isSending: boolean;
  messages: ChatMessage[];
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <div className="relative z-1 flex-1 overflow-y-auto px-5 py-5 max-sm:px-4">
      {notice ? <ChatNotice notice={notice} /> : null}
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
          isSending={isSending}
          messagesEndRef={messagesEndRef}
        />
      )}
    </div>
  );
}

function ChatMessageList({
  messages,
  isSending,
  messagesEndRef,
}: {
  messages: ChatMessage[];
  isSending: boolean;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <div className="mx-auto flex max-w-[820px] flex-col gap-6">
      {messages.map((message) => (
        <MessageBubble key={message.id} message={message} />
      ))}
      {isSending ? (
        <div className="flex items-center gap-2 text-sm text-white/44">
          <Loader2 className="size-4 animate-spin text-[rgb(var(--theme-color-rgb))]" />
          Sivraj is retrieving memory and asking the model.
        </div>
      ) : null}
      <div ref={messagesEndRef} />
    </div>
  );
}

function ChatNotice({ notice }: { notice: NonNullable<Notice> }) {
  return (
    <div
      className={cn(
        "mb-4 rounded-2xl border px-4 py-3 text-sm",
        notice.tone === "error"
          ? "border-red-300/20 bg-red-500/10 text-red-100/86"
          : "border-white/10 bg-white/5 text-white/70",
      )}
    >
      {notice.text}
    </div>
  );
}
