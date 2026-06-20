import {
  CheckCircle2,
  Coins,
  ExternalLink,
  Loader2,
  XCircle,
  FileText,
} from "lucide-react";
import { useState } from "react";
import { ChatMessageContent } from "@/components/chat/ChatMessageContent";
import { TypingText } from "@/components/chat/TypingText";
import { ClipboardActionButton } from "@/components/ui/clipboard-action-button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  formatChatAttachmentStatus,
  readChatMessageAttachments,
} from "@/lib/chat/chat-attachments";
import { cn } from "@/lib/ui/utils";
import type { ChatMessage, ChatMessageAttachment } from "@/lib/chat/chat-api";

export function MessageBubble({
  message,
  onOpenAttachment,
}: {
  message: ChatMessage;
  onOpenAttachment: (attachment: ChatMessageAttachment) => void;
}) {
  const isUser = message.role === "user";
  const isFailed = message.status === "failed";
  const isStreamingAssistant = !isUser && message.status === "streaming";
  const attachments = readChatMessageAttachments(message);
  const hasTextContent = message.content.trim().length > 0;
  const estimatedTokensSaved = readEstimatedTokensSaved(message);
  const isWaitingForAssistant =
    !isUser &&
    !hasTextContent &&
    attachments.length === 0 &&
    (message.status === "pending" || message.status === "streaming");

  if (!isUser && isFailed) {
    return null;
  }

  if (isWaitingForAssistant) {
    return <AssistantTypingIndicator />;
  }

  return (
    <article className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "group/message max-w-[min(100%,720px)]",
          isUser ? "text-right" : "text-left",
        )}
      >
        {attachments.length > 0 ? (
          <MessageAttachments
            attachments={attachments}
            onOpenAttachment={onOpenAttachment}
          />
        ) : null}
        {isUser && hasTextContent ? (
          <div className="inline-block text-left max-w-full whitespace-pre-wrap rounded-[18px] border border-[rgba(var(--theme-color-rgb),0.18)] bg-[rgba(var(--theme-color-rgb),0.08)] px-4 py-2.5 text-[0.95rem] leading-6 text-white/86 shadow-[0_14px_34px_rgba(0,0,0,0.18)]">
            {message.content}
          </div>
        ) : null}
        {!isUser ? (
          <div
            className={cn(
              "text-[1rem] leading-7",
              isFailed
                ? "max-w-[min(100%,620px)] rounded-2xl border border-red-300/18 bg-red-500/8 px-4 py-3 text-red-100/82"
                : "text-white/84",
            )}
          >
            {isStreamingAssistant ? (
              <TypingText text={message.content} />
            ) : (
              <ChatMessageContent content={message.content} />
            )}
          </div>
        ) : null}
        {hasTextContent ? (
          <MessageActions
            isUser={isUser}
            content={message.content}
            estimatedTokensSaved={estimatedTokensSaved}
          />
        ) : null}
      </div>
    </article>
  );
}

function MessageAttachments({
  attachments,
  onOpenAttachment,
}: {
  attachments: ChatMessageAttachment[];
  onOpenAttachment: (attachment: ChatMessageAttachment) => void;
}) {
  return (
    <div className="mb-2 flex flex-col items-end gap-2">
      {attachments.map((attachment) => (
        <AttachmentChip
          key={attachment.artifactId}
          attachment={attachment}
          onOpenAttachment={onOpenAttachment}
        />
      ))}
    </div>
  );
}

function AttachmentChip({
  attachment,
  onOpenAttachment,
}: {
  attachment: ChatMessageAttachment;
  onOpenAttachment: (attachment: ChatMessageAttachment) => void;
}) {
  const status = formatChatAttachmentStatus(attachment);
  const content = (
    <>
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/7 text-white/72">
        <AttachmentIcon attachment={attachment} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[0.95rem] font-semibold text-white/86">
          {attachment.fileName}
        </span>
        <span className="mt-0.5 flex items-center gap-2 text-xs text-white/42">
          <StatusIcon status={attachment.status} />
          <span>{status}</span>
          {attachment.fileSize != null ? (
            <span>{formatFileSize(attachment.fileSize)}</span>
          ) : null}
        </span>
      </span>
      {isPreviewableAttachment(attachment) ? (
        <ExternalLink className="size-4 shrink-0 text-white/38" />
      ) : null}
    </>
  );
  const className =
    "flex w-[min(100%,380px)] items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.045] px-3 py-2.5 text-left shadow-[0_14px_34px_rgba(0,0,0,0.16)] transition hover:border-white/18 hover:bg-white/[0.065]";

  return isPreviewableAttachment(attachment) ? (
    <button
      type="button"
      className={className}
      aria-label={`Open ${attachment.fileName}`}
      onClick={() => onOpenAttachment(attachment)}
    >
      {content}
    </button>
  ) : (
    <div className={className} aria-label={`${attachment.fileName} uploaded`}>
      {content}
    </div>
  );
}

function AttachmentIcon({ attachment }: { attachment: ChatMessageAttachment }) {
  if (attachment.sourceType === "pdf" || attachment.sourceType === "ocr_pdf") {
    return (
      <img
        src="/icons/pdf.webp"
        alt=""
        className="size-6 object-contain"
        draggable={false}
      />
    );
  }

  return <FileText className="size-5" />;
}

function isPreviewableAttachment(attachment: ChatMessageAttachment) {
  return attachment.sourceType === "pdf" ||
    attachment.sourceType === "ocr_pdf" ||
    attachment.sourceType === "markdown" ||
    attachment.sourceType === "upload" ||
    Boolean(attachment.localPreviewUrl);
}

function StatusIcon({ status }: { status: ChatMessageAttachment["status"] }) {
  if (status === "failed" || status === "cancelled") {
    return <XCircle className="size-3.5 text-red-200/70" />;
  }

  if (status === "completed") {
    return <CheckCircle2 className="size-3.5 text-emerald-200/70" />;
  }

  return <Loader2 className="size-3.5 animate-spin text-white/45" />;
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function MessageActions({
  isUser,
  content,
  estimatedTokensSaved,
}: {
  isUser: boolean;
  content: string;
  estimatedTokensSaved: number;
}) {
  const showTokenSavings = !isUser && estimatedTokensSaved > 0;

  return (
    <div
      className={cn(
        "mt-1 flex items-center gap-1 opacity-0 transition-opacity group-hover/message:opacity-100 group-focus-within/message:opacity-100",
        isUser ? "justify-end" : "justify-start",
      )}
    >
      <ClipboardActionButton
        action="copy"
        value={content}
        aria-label="Copy message"
      />
      {showTokenSavings ? (
        <TokenSavingsIcon estimatedTokensSaved={estimatedTokensSaved} />
      ) : null}
    </div>
  );
}

export function AssistantTypingIndicator() {
  return (
    <article className="flex justify-start">
      <output
        className="flex h-7 items-center gap-2"
        aria-label="Assistant is responding"
      >
        <span className="chat-typing-dot bg-white/70" />
        <span className="chat-typing-dot chat-typing-dot-delayed bg-white/55" />
        <span className="chat-typing-dot chat-typing-dot-late bg-white/40" />
      </output>
    </article>
  );
}

function TokenSavingsIcon({
  estimatedTokensSaved,
}: {
  estimatedTokensSaved: number;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const label = `${estimatedTokensSaved.toLocaleString()} tokens saved`;

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          onBlur={() => setIsOpen(false)}
          onFocus={() => setIsOpen(true)}
          onPointerEnter={() => setIsOpen(true)}
          onPointerLeave={() => setIsOpen(false)}
          className="grid size-7 place-items-center rounded-full text-white/30 transition hover:bg-white/7 hover:text-white/72 focus-visible:bg-white/7 focus-visible:text-white/72 focus-visible:outline-none"
        >
          <Coins className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" className="pointer-events-none">
        {label}
      </PopoverContent>
    </Popover>
  );
}

function readEstimatedTokensSaved(message: ChatMessage): number {
  const tokenSavings = message.metadata?.["tokenSavings"];

  if (!tokenSavings || typeof tokenSavings !== "object") {
    return 0;
  }

  const value = (tokenSavings as { estimatedTokensSaved?: unknown })
    .estimatedTokensSaved;
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : 0;
}
