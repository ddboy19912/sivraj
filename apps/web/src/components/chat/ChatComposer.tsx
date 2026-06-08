import { Paperclip, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { liquidGlassDense } from "@/lib/ui/liquid-glass";
import { cn } from "@/lib/ui/utils";

type ChatComposerProps = {
  draft: string;
  isSending: boolean;
  onDraftChange: (value: string) => void;
  onComposerKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onSendMessage: () => void;
};

export function ChatComposer({
  draft,
  isSending,
  onDraftChange,
  onComposerKeyDown,
  onSendMessage,
}: ChatComposerProps) {
  return (
    <footer className="relative z-1 shrink-0 border-t border-white/8 p-4">
      <div
        className={cn(
          liquidGlassDense,
          "mx-auto flex max-w-[860px] items-end gap-2 rounded-[24px] p-2",
        )}
      >
        <button
          type="button"
          aria-label="Attach context"
          title="Attach context"
          className="grid size-10 shrink-0 place-items-center rounded-full text-white/40 transition hover:bg-white/7 hover:text-white/70"
        >
          <Paperclip className="size-5" />
        </button>
        <textarea
          aria-label="Message Sivraj"
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={onComposerKeyDown}
          rows={1}
          placeholder="Ask Sivraj..."
          className="max-h-32 min-h-10 flex-1 resize-none bg-transparent px-1 py-2 text-base text-white outline-none placeholder:text-white/30"
        />
        <Button
          type="button"
          size="icon-lg"
          variant="secondary"
          aria-label="Send message"
          disabled={isSending || draft.trim().length === 0}
          onClick={onSendMessage}
        >
          <Send className="size-4" />
        </Button>
      </div>
    </footer>
  );
}
