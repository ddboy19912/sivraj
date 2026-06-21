import type {
  ChatMemoryIntent,
  ChatMessage,
  ChatMessageAttachment,
  ChatThread,
} from "@/lib/chat/chat-api";
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

export type ChatPageStatus =
  | "booting"
  | "ready"
  | "sending"
  | "retrieving_context"
  | "streaming"
  | "failed"
  | "disconnected";

export type ChatAttachmentUploadStatus = {
  phase: "idle" | "encrypting" | "uploading" | "processing";
  fileName: string | null;
};

export type ChatConversationPanelProps = {
  activeThread: ChatThread | null;
  providerPresentation: ProviderPresentation;
  twinName: string;
  status: ChatPageStatus;
  notice: ChatNotice;
  isLoading: boolean;
  isSending: boolean;
  attachmentUploadStatus: ChatAttachmentUploadStatus;
  messages: ChatMessage[];
  draft: string;
  memoryIntent: ChatMemoryIntent;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
  onCreateThread: () => void;
  onDeleteThread: (threadId: string) => void;
  onDraftChange: (value: string) => void;
  onMemoryIntentChange: (value: ChatMemoryIntent) => void;
  onComposerKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onSendMessage: () => void;
  onStopStreaming: () => void;
  onRetryLastMessage: () => void;
  onAttachFiles: (files: FileList | null) => void;
  onOpenAttachment: (attachment: ChatMessageAttachment) => void;
  onSaveDraftAsSource: (fileName: string) => void;
  onSaveMessageAsSource: (
    content: string,
    fileName: string,
    role: ChatMessage["role"],
  ) => void;
  onSaveCodeBlockAsSource: (content: string, fileName: string) => void;
};
