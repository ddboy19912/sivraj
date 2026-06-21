import { ChatThreadListItem } from "@/components/chat/ChatThreadListItem";
import { ChatThreadSidebarHeader } from "@/components/chat/ChatThreadSidebarHeader";
import { liquidGlass } from "@/lib/ui/liquid-glass";
import { cn } from "@/lib/ui/utils";
import type { ChatThread } from "@/lib/chat/chat-api";

type ChatThreadSidebarProps = {
  threads: ChatThread[];
  activeThreadId: string | null;
  onSelectThread: (threadId: string) => void;
  onCreateThread: () => void;
  onDeleteThread: (threadId: string) => void;
};

export function ChatThreadSidebar({
  threads,
  activeThreadId,
  onSelectThread,
  onCreateThread,
  onDeleteThread,
}: ChatThreadSidebarProps) {
  return (
    <aside
      className={cn(
        liquidGlass,
        "hidden min-h-0 w-[340px] shrink-0 flex-col overflow-hidden rounded-[24px] p-2.5 md:flex",
      )}
    >
      <ChatThreadSidebarHeader
        threadCount={threads.length}
        onCreateThread={onCreateThread}
      />
      <div className="relative z-1 mt-1.5 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overscroll-contain pr-0.5">
        {threads.map((thread) => (
          <ChatThreadListItem
            key={thread.id}
            thread={thread}
            isActive={activeThreadId === thread.id}
            onSelect={() => onSelectThread(thread.id)}
            onDelete={() => onDeleteThread(thread.id)}
          />
        ))}
      </div>
    </aside>
  );
}
