import { formatRelativeTime } from "@/lib/chat/chat-formatters";
import { cn } from "@/lib/ui/utils";
import type { ChatThread } from "@/lib/chat/chat-api";

type ChatThreadListItemProps = {
  thread: ChatThread;
  isActive: boolean;
  onSelect: () => void;
};

export function ChatThreadListItem({
  thread,
  isActive,
  onSelect,
}: ChatThreadListItemProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "rounded-2xl px-3 py-3 text-left transition",
        isActive
          ? "bg-[rgba(var(--theme-color-rgb),0.13)] text-white"
          : "text-white/58 hover:bg-white/6 hover:text-white/84",
      )}
    >
      <span className="block truncate text-sm font-semibold">{thread.title}</span>
      <span className="mt-1 block text-[11px] text-white/38">
        {formatRelativeTime(thread.updatedAt)}
      </span>
    </button>
  );
}
