import type { ChatMessage, ChatThread } from "@/lib/chat/chat-api";
import type { ProviderPresentation } from "@/lib/chat/chat-formatters";

export type AiChatProvider = "chatgpt" | "claude" | "generic_chat";

export type AiChatConversationPreview = {
  sourceConversationId: string | null;
  title: string | null;
  messageCount: number;
  firstMessageAt: string | null;
  lastMessageAt: string | null;
  sourceMessageIds: string[];
};

export type AiChatImportPreview = {
  provider: AiChatProvider;
  conversations: AiChatConversationPreview[];
  messageCount: number;
  fingerprint: string;
};

export type ChatNotice = {
  tone: "error" | "info";
  text: string;
} | null;

export type ChatConversationPanelProps = {
  activeThread: ChatThread | null;
  providerPresentation: ProviderPresentation;
  notice: ChatNotice;
  isLoading: boolean;
  isSending: boolean;
  messages: ChatMessage[];
  draft: string;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
  onOpenProviderSettings: () => void;
  onCreateThread: () => void;
  onDraftChange: (value: string) => void;
  onComposerKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onSendMessage: () => void;
};
