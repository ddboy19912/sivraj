import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

type ChatThreadSidebarHeaderProps = {
  threadCount: number;
  onCreateThread: () => void;
};

export function ChatThreadSidebarHeader({
  threadCount,
  onCreateThread,
}: ChatThreadSidebarHeaderProps) {
  return (
    <div className="relative z-1 flex items-center justify-between px-2 py-2">
      <div>
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[rgb(var(--theme-color-rgb))]">
          History
        </p>
        <p className="text-xs text-white/44">
          {threadCount} thread{threadCount === 1 ? "" : "s"}
        </p>
      </div>
      <Button
        type="button"
        size="icon"
        variant="secondary"
        aria-label="New chat"
        onClick={onCreateThread}
      >
        <Plus className="size-4" />
      </Button>
    </div>
  );
}
