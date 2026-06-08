import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { liquidGlassDense } from "@/lib/ui/liquid-glass";
import { cn } from "@/lib/ui/utils";
import type { ChatThread } from "@/lib/chat/chat-api";
import type { ProviderPresentation } from "@/lib/chat/chat-formatters";

type ChatConversationHeaderProps = {
  activeThread: ChatThread | null;
  providerPresentation: ProviderPresentation;
  onOpenProviderSettings: () => void;
  onCreateThread: () => void;
};

export function ChatConversationHeader({
  activeThread,
  providerPresentation,
  onOpenProviderSettings,
  onCreateThread,
}: ChatConversationHeaderProps) {
  return (
    <header className="relative z-1 flex shrink-0 items-center justify-between border-b border-white/8 px-5 py-4 max-sm:px-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="size-2 rounded-full bg-[rgb(var(--theme-color-rgb))] shadow-[0_0_14px_rgba(var(--theme-color-rgb),0.7)]" />
          <h1 className="truncate font-mono text-lg font-bold uppercase tracking-[0.08em] text-white">
            {activeThread?.title ?? "Sivraj Chat"}
          </h1>
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-white/42">
          <span>Model: {providerPresentation.label}</span>
          <span>Memory: Sivraj</span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={onOpenProviderSettings}
          className={cn(
            liquidGlassDense,
            "rounded-full px-3 py-2 text-xs font-semibold text-white/70 transition hover:text-white",
          )}
        >
          {providerPresentation.mode}
        </button>
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
