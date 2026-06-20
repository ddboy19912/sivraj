import { Sparkles } from "lucide-react";

export function ChatMessagesEmptyState() {
  return (
    <div className="mx-auto grid max-w-[520px] gap-4 text-center">
      <div className="mx-auto grid size-12 place-items-center rounded-full border border-[rgba(var(--theme-color-rgb),0.28)] bg-[rgba(var(--theme-color-rgb),0.09)]">
        <Sparkles className="size-5 text-[rgb(var(--theme-color-rgb))]" />
      </div>
      <div>
        <h2 className="text-xl font-semibold tracking-tight text-white">
          What can I help you with today?
        </h2>
        <p className="mt-2 text-sm leading-6 text-white/56">
          Ask a question, continue an idea, or tell me what you want to work through.
        </p>
      </div>
    </div>
  );
}
