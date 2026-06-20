import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ChatThread } from "@/lib/chat/chat-api";
import type { ProviderPresentation } from "@/lib/chat/chat-formatters";

type ChatConversationHeaderProps = {
  activeThread: ChatThread | null;
  providerPresentation: ProviderPresentation;
  twinName: string;
  onCreateThread: () => void;
  onDeleteThread: (threadId: string) => void;
};

export function ChatConversationHeader({
  activeThread,
  providerPresentation,
  twinName,
  onCreateThread,
  onDeleteThread,
}: ChatConversationHeaderProps) {
  const assistantName = twinName || "Your twin";

  return (
    <header className="relative z-1 flex shrink-0 items-center justify-between border-b border-white/8 px-5 py-4 max-sm:px-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="size-2 rounded-full bg-[rgb(var(--theme-color-rgb))] shadow-[0_0_14px_rgba(var(--theme-color-rgb),0.7)]" />
          <h1 className="truncate font-mono text-lg font-bold uppercase tracking-[0.08em] text-white">
            {activeThread?.title ?? `${assistantName} Chat`}
          </h1>
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] font-medium text-white/42">
          <span>Model: {providerPresentation.label}</span>
          <span>Memory: {assistantName}</span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {activeThread ? (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label="Delete chat"
            title="Delete chat"
            onClick={() => onDeleteThread(activeThread.id)}
          >
            <Trash2 className="size-4" />
          </Button>
        ) : null}
        <Button
          type="button"
          size="icon"
          variant="secondary"
          aria-label="New chat"
          onClick={onCreateThread}
          className="md:hidden"
        >
          <Plus className="size-4" />
        </Button>
      </div>
    </header>
  );
}
