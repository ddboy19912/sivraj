import { Trash2 } from "lucide-react";
import type { ChatThread } from "@/lib/chat/chat-api";
import { formatRelativeTime } from "@/lib/chat/chat-formatters";
import { cn } from "@/lib/ui/utils";

type ChatThreadListItemProps = {
  thread: ChatThread;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
};

export function ChatThreadListItem({
  thread,
  isActive,
  onSelect,
  onDelete,
}: ChatThreadListItemProps) {
  return (
    <div
      className={cn(
        "group/thread-item flex items-center gap-1 rounded-2xl transition",
        isActive
          ? "bg-[rgba(var(--theme-color-rgb),0.13)] text-white"
          : "text-white/58 hover:bg-white/6 hover:text-white/84",
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        className="min-w-0 flex-1 px-3 py-3 text-left"
      >
        <p className="truncate text-sm font-semibold">
          {thread.title}
        </p>
        <span className="mt-1 block text-[11px] text-white/38">
          {formatRelativeTime(thread.updatedAt)}
        </span>
      </button>
      <button
        type="button"
        aria-label={`Delete ${thread.title}`}
        title="Delete chat"
        onClick={onDelete}
        className="mr-2 grid size-8 shrink-0 place-items-center rounded-full text-white/28 opacity-0 transition hover:bg-white/7 hover:text-white/72 group-hover/thread-item:opacity-100 focus-visible:opacity-100"
      >
        <Trash2 className="size-3.5" />
      </button>
    </div>
  );
}
