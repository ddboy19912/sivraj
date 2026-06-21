import {
  Brain,
  Loader2,
  Paperclip,
  RotateCcw,
  Send,
  Sparkles,
  Square,
  VenetianMask,
} from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { AgentSkillSaveMenu } from "@/components/chat/AgentSkillSaveMenu";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { liquidGlassDense } from "@/lib/ui/liquid-glass";
import { cn } from "@/lib/ui/utils";
import type { ChatMemoryIntent } from "@/lib/chat/chat-api";
import type { ChatAttachmentUploadStatus, ChatNotice, ChatPageStatus } from "@/types/chat.types";

type ChatComposerProps = {
  draft: string;
  memoryIntent: ChatMemoryIntent;
  twinName: string;
  status: ChatPageStatus;
  notice: ChatNotice;
  isSending: boolean;
  attachmentUploadStatus: ChatAttachmentUploadStatus;
  onDraftChange: (value: string) => void;
  onMemoryIntentChange: (value: ChatMemoryIntent) => void;
  onComposerKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onSendMessage: () => void;
  onStopStreaming: () => void;
  onRetryLastMessage: () => void;
  onAttachFiles: (files: FileList | null) => void;
  onSaveDraftAsSource: (fileName: string) => void;
};

export function ChatComposer({
  draft,
  memoryIntent,
  twinName,
  status,
  notice,
  isSending,
  attachmentUploadStatus,
  onDraftChange,
  onMemoryIntentChange,
  onComposerKeyDown,
  onSendMessage,
  onStopStreaming,
  onRetryLastMessage,
  onAttachFiles,
  onSaveDraftAsSource,
}: ChatComposerProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const canRetry = status === "failed";
  const assistantName = twinName || "your twin";
  const canSend = status !== "failed" && draft.trim().length > 0;
  const isUploadingAttachment = attachmentUploadStatus.phase !== "idle";
  const failureText = status === "failed" && notice?.tone === "error" ? notice.text : null;

  useLayoutEffect(() => {
    const textarea = textareaRef.current;

    if (!textarea) {
      return;
    }

    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [draft]);

  return (
    <footer className="relative z-1 shrink-0 border-t border-white/8 p-4">
      {failureText ? (
        <div className="mx-auto mb-2 flex max-w-[860px] items-center justify-between gap-3 rounded-2xl border border-red-300/16 bg-red-500/8 px-4 py-2 text-sm text-red-100/78">
          <span className="min-w-0 flex-1 text-left">{failureText}</span>
          <button
            type="button"
            onClick={onRetryLastMessage}
            className="shrink-0 rounded-full border border-red-100/16 px-3 py-1 text-xs font-semibold text-red-50/80 transition hover:bg-red-50/8 hover:text-red-50"
          >
            Retry
          </button>
        </div>
      ) : null}
      <div
        className={cn(
          liquidGlassDense,
          "mx-auto flex max-w-[860px] items-end gap-2 rounded-[24px] p-2",
        )}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.md,.markdown,.mdx,.mdc,.cursorrules,.txt,.json,.csv,.html,.htm,image/*"
          aria-label="Upload context file"
          className="sr-only"
          onChange={(event) => {
            onAttachFiles(event.currentTarget.files);
            event.currentTarget.value = "";
          }}
        />
        <button
          type="button"
          aria-label="Attach context"
          title={isUploadingAttachment ? "Attachment is processing" : "Attach context"}
          disabled={isUploadingAttachment}
          onClick={() => fileInputRef.current?.click()}
          className="grid size-10 shrink-0 place-items-center rounded-full text-white/40 transition hover:bg-white/7 hover:text-white/70 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isUploadingAttachment
            ? <Loader2 className="size-5 animate-spin" />
            : <Paperclip className="size-5" />}
        </button>
        <MemoryIntentSelector
          value={memoryIntent}
          disabled={isSending}
          onChange={onMemoryIntentChange}
        />
        <AgentSkillSaveMenu
          ariaLabel="Save draft as source file"
          disabled={isUploadingAttachment || draft.trim().length === 0}
          defaultFileName="notes.md"
          triggerClassName="size-10 shrink-0 text-white/40 hover:text-white/70"
          onSelect={onSaveDraftAsSource}
        />
        <textarea
          ref={textareaRef}
          aria-label={`Message ${assistantName}`}
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={onComposerKeyDown}
          rows={1}
          placeholder={`Ask ${assistantName}...`}
          className="max-h-32 min-h-10 flex-1 resize-none overflow-y-auto bg-transparent px-1 py-2 text-base text-white outline-none placeholder:text-white/30"
        />
        <Button
          type="button"
          size="icon-lg"
          variant="secondary"
          aria-label={isSending ? "Stop streaming" : "Send message"}
          disabled={!isSending && !canSend}
          onClick={isSending ? onStopStreaming : onSendMessage}
        >
          {isSending ? <Square className="size-4" /> : <Send className="size-4" />}
        </Button>
        {canRetry ? (
          <Button
            type="button"
            size="icon-lg"
            variant="default"
            aria-label="Retry last message"
            title="Retry last message"
            onClick={onRetryLastMessage}
          >
            <RotateCcw className="size-4" />
          </Button>
        ) : null}
      </div>
    </footer>
  );
}

const MEMORY_INTENT_OPTIONS: Array<{
  value: ChatMemoryIntent;
  label: string;
  description: string;
  Icon: typeof Sparkles;
}> = [
  {
    value: "auto",
    label: "Auto",
    description: "Sivraj decides what should become durable memory.",
    Icon: Sparkles,
  },
  {
    value: "remember",
    label: "Remember",
    description: "Save this message as memory, even if it is casual.",
    Icon: Brain,
  },
  {
    value: "private",
    label: "Private",
    description: "Answer normally, but do not store this message as memory.",
    Icon: VenetianMask,
  },
];

function MemoryIntentSelector({
  value,
  disabled,
  onChange,
}: {
  value: ChatMemoryIntent;
  disabled: boolean;
  onChange: (value: ChatMemoryIntent) => void;
}) {
  const [openValue, setOpenValue] = useState<ChatMemoryIntent | null>(null);

  return (
    <div className="flex h-10 shrink-0 items-center gap-0.5 rounded-full border border-white/8 bg-black/18 p-1">
      <div
        className="flex items-center gap-0.5"
        role="radiogroup"
        aria-label="Memory behavior"
      >
        {MEMORY_INTENT_OPTIONS.map(({ value: optionValue, label, description, Icon }) => {
          const active = value === optionValue;

          return (
            <Popover
              key={optionValue}
              open={openValue === optionValue}
              onOpenChange={(nextOpen) => setOpenValue(nextOpen ? optionValue : null)}
            >
              <PopoverTrigger asChild>
                <button
                  type="button"
                  role="radio"
                  aria-checked={active}
                  aria-label={label}
                  disabled={disabled}
                  onClick={() => onChange(optionValue)}
                  onMouseEnter={() => setOpenValue(optionValue)}
                  onMouseLeave={() => setOpenValue(null)}
                  onFocus={() => setOpenValue(optionValue)}
                  onBlur={() => setOpenValue(null)}
                  className={cn(
                    "grid size-8 place-items-center rounded-full text-white/38 transition disabled:cursor-not-allowed disabled:opacity-50",
                    active
                      ? "bg-[rgba(var(--theme-color-rgb),0.16)] text-[rgb(var(--theme-color-rgb))]"
                      : "hover:bg-white/7 hover:text-white/72",
                  )}
                >
                  <Icon className="size-4" />
                </button>
              </PopoverTrigger>
              <PopoverContent
                side="top"
                className="pointer-events-none w-64 px-3 py-2 text-left text-xs leading-relaxed"
              >
                <span className="font-semibold text-white/92">{label}:</span>{" "}
                <span className="text-white/72">{description}</span>
              </PopoverContent>
            </Popover>
          );
        })}
      </div>
    </div>
  );
}
