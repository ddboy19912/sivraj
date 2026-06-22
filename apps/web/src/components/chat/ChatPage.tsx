import {
  ChatConversationPanel,
  ChatSignedOutView,
  ChatThreadSidebar,
} from "@/components/chat/chat-page-components";
import { useChatPage } from "@/hooks/chat/use-chat-page";
import type { Session } from "@/lib/session";
import type { ProviderConfigResponse } from "@/lib/chat/chat-api";

type ChatPageProps = {
  session: Session | null;
  isSessionForWallet: boolean;
  twinName: string;
  onSessionRefreshed: (session: Session) => void;
  providerState: ProviderConfigResponse | null;
  onProviderStateChange: (state: ProviderConfigResponse | null) => void;
};

export function ChatPage(props: ChatPageProps) {
  const chat = useChatPage(props);

  if (!chat.canChat) {
    return <ChatSignedOutView />;
  }

  return (
    <section className="absolute inset-0 z-10 min-h-0 overflow-hidden px-5 pt-[76px] pb-[92px] max-lg:px-4 max-md:pt-[70px] max-md:pb-[86px]">
      <div className="mx-auto flex h-full min-h-0 w-full max-w-[1220px] gap-4 max-md:gap-3">
        <ChatThreadSidebar
          threads={chat.threads}
          activeThreadId={chat.activeThreadId}
          onSelectThread={(threadId) => void chat.switchThread(threadId)}
          onCreateThread={() => void chat.startNewThread()}
          onDeleteThread={(threadId) => void chat.deleteThread(threadId)}
        />
        <ChatConversationPanel
          activeThread={chat.activeThread}
          providerPresentation={chat.providerPresentation}
          twinName={props.twinName}
          status={chat.status}
          notice={chat.notice}
          isLoading={chat.isLoading}
          isSending={chat.isSending}
          attachmentUploadStatus={chat.attachmentUploadStatus}
          messages={chat.messages}
          draft={chat.draft}
          memoryIntent={chat.memoryIntent}
          messagesEndRef={chat.messagesEndRef}
          onCreateThread={() => void chat.startNewThread()}
          onDeleteThread={(threadId) => void chat.deleteThread(threadId)}
          onDraftChange={chat.setDraft}
          onMemoryIntentChange={chat.setMemoryIntent}
          onComposerKeyDown={chat.handleComposerKeyDown}
          onSendMessage={() => void chat.sendMessage()}
          onStopStreaming={chat.stopStreaming}
          onRetryLastMessage={() => void chat.retryLastMessage()}
          failedAttachmentCount={chat.failedAttachmentCount}
          onAttachFiles={(files) => void chat.attachFiles(files)}
          onRetryFailedAttachments={() => void chat.retryFailedAttachments()}
          onOpenAttachment={(attachment) => void chat.openAttachment(attachment)}
          onSaveDraftAsSource={(fileName) => void chat.saveDraftAsSource(fileName)}
          onSaveMessageAsSource={(content, fileName, role) =>
            void chat.saveMessageAsSource(content, fileName, role)}
          onSaveCodeBlockAsSource={(content, fileName) =>
            void chat.saveCodeBlockAsSource(content, fileName)}
        />
      </div>
    </section>
  );
}
