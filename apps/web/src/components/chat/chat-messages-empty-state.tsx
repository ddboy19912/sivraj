import { Sparkles } from "lucide-react";

export function ChatMessagesEmptyState() {
  return (
    <div className="mx-auto grid max-w-[520px] gap-5 text-center">
      <div className="mx-auto grid size-12 place-items-center rounded-full border border-[rgba(var(--theme-color-rgb),0.28)] bg-[rgba(var(--theme-color-rgb),0.09)]">
        <Sparkles className="size-5 text-[rgb(var(--theme-color-rgb))]" />
      </div>
      <div>
        <h2 className="text-xl font-semibold tracking-tight text-white">
          Sivraj remembers across models
        </h2>
        <p className="mt-2 text-sm leading-6 text-white/56">
          Ask with any connected model. Sivraj supplies durable memory, compact context, and citations.
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-white/48">
        <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5">
          No cutoff dependency
        </span>
        <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5">
          Lower token repeat
        </span>
        <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5">
          Model portable
        </span>
      </div>
    </div>
  );
}
