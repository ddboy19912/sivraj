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
    <aside className={cn(liquidGlass, "hidden w-[260px] shrink-0 overflow-hidden rounded-[28px] p-3 md:block")}>
      <ChatThreadSidebarHeader
        threadCount={threads.length}
        onCreateThread={onCreateThread}
      />
      <div className="relative z-1 mt-2 grid gap-1 overflow-y-auto pr-1">
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
