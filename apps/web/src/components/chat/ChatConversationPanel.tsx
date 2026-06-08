import { ChatComposer } from "@/components/chat/ChatComposer";
import { ChatConversationHeader } from "@/components/chat/ChatConversationHeader";
import { ChatMessagesViewport } from "@/components/chat/chat-messages-viewport";
import { liquidGlass } from "@/lib/ui/liquid-glass";
import { cn } from "@/lib/ui/utils";
import type { ChatConversationPanelProps } from "@/types/chat.types";

export function ChatConversationPanel({
  activeThread,
  providerPresentation,
  notice,
  isLoading,
  isSending,
  messages,
  draft,
  messagesEndRef,
  onOpenProviderSettings,
  onCreateThread,
  onDraftChange,
  onComposerKeyDown,
  onSendMessage,
}: ChatConversationPanelProps) {
  return (
    <div className={cn(liquidGlass, "flex min-w-0 flex-1 flex-col overflow-hidden rounded-[32px]")}>
      <ChatConversationHeader
        activeThread={activeThread}
        providerPresentation={providerPresentation}
        onOpenProviderSettings={onOpenProviderSettings}
        onCreateThread={onCreateThread}
      />
      <ChatMessagesViewport
        notice={notice}
        isLoading={isLoading}
        isSending={isSending}
        messages={messages}
        messagesEndRef={messagesEndRef}
      />
      <ChatComposer
        draft={draft}
        isSending={isSending}
        onDraftChange={onDraftChange}
        onComposerKeyDown={onComposerKeyDown}
        onSendMessage={onSendMessage}
      />
    </div>
  );
}
