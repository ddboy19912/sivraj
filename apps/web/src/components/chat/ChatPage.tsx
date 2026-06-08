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
  onSessionRefreshed: (session: Session) => void;
  onOpenProviderSettings: () => void;
  providerState: ProviderConfigResponse | null;
  onProviderStateChange: (state: ProviderConfigResponse | null) => void;
};

export function ChatPage(props: ChatPageProps) {
  const chat = useChatPage(props);

  if (!chat.canChat) {
    return <ChatSignedOutView />;
  }

  return (
    <section className="absolute inset-x-4 top-[84px] bottom-[104px] z-10 mx-auto flex max-w-[1180px] gap-3 max-md:top-[76px] max-md:bottom-[96px]">
      <ChatThreadSidebar
        threads={chat.threads}
        activeThreadId={chat.activeThreadId}
        onSelectThread={(threadId) => void chat.switchThread(threadId)}
        onCreateThread={() => void chat.startNewThread()}
      />
      <ChatConversationPanel
        activeThread={chat.activeThread}
        providerPresentation={chat.providerPresentation}
        notice={chat.notice}
        isLoading={chat.isLoading}
        isSending={chat.isSending}
        messages={chat.messages}
        draft={chat.draft}
        messagesEndRef={chat.messagesEndRef}
        onOpenProviderSettings={props.onOpenProviderSettings}
        onCreateThread={() => void chat.startNewThread()}
        onDraftChange={chat.setDraft}
        onComposerKeyDown={chat.handleComposerKeyDown}
        onSendMessage={() => void chat.sendMessage()}
      />
    </section>
  );
}
