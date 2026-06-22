import { ChatComposer } from "@/components/chat/ChatComposer";
import { ChatConversationHeader } from "@/components/chat/ChatConversationHeader";
import { ChatMessagesViewport } from "@/components/chat/chat-messages-viewport";
import { liquidGlass } from "@/lib/ui/liquid-glass";
import { cn } from "@/lib/ui/utils";
import type { ChatConversationPanelProps } from "@/types/chat.types";

export function ChatConversationPanel({
  activeThread,
  providerPresentation,
  twinName,
  status,
  notice,
  isLoading,
  isSending,
  attachmentUploadStatus,
  messages,
  draft,
  memoryIntent,
  messagesEndRef,
  onCreateThread,
  onDeleteThread,
  onDraftChange,
  onMemoryIntentChange,
  onComposerKeyDown,
  onSendMessage,
  onStopStreaming,
  onRetryLastMessage,
  failedAttachmentCount,
  onAttachFiles,
  onRetryFailedAttachments,
  onOpenAttachment,
  onSaveDraftAsSource,
  onSaveMessageAsSource,
  onSaveCodeBlockAsSource,
}: ChatConversationPanelProps) {
  return (
    <div className={cn(liquidGlass, "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[24px]")}>
      <ChatConversationHeader
        activeThread={activeThread}
        providerPresentation={providerPresentation}
        twinName={twinName}
        onCreateThread={onCreateThread}
        onDeleteThread={onDeleteThread}
      />
      <ChatMessagesViewport
        status={status}
        notice={notice}
        isLoading={isLoading}
        isSending={isSending}
        messages={messages}
        messagesEndRef={messagesEndRef}
        onOpenAttachment={onOpenAttachment}
        onSaveMessageAsSource={onSaveMessageAsSource}
        onSaveCodeBlockAsSource={onSaveCodeBlockAsSource}
      />
      <ChatComposer
        autoFocus
        draft={draft}
        memoryIntent={memoryIntent}
        twinName={twinName}
        status={status}
        notice={notice}
        isSending={isSending}
        attachmentUploadStatus={attachmentUploadStatus}
        onDraftChange={onDraftChange}
        onMemoryIntentChange={onMemoryIntentChange}
        onComposerKeyDown={onComposerKeyDown}
        onSendMessage={onSendMessage}
        onStopStreaming={onStopStreaming}
        onRetryLastMessage={onRetryLastMessage}
        failedAttachmentCount={failedAttachmentCount}
        onAttachFiles={onAttachFiles}
        onRetryFailedAttachments={onRetryFailedAttachments}
        onSaveDraftAsSource={onSaveDraftAsSource}
      />
    </div>
  );
}
