import { MessageCircle } from "lucide-react";
import { liquidGlass } from "@/lib/ui/liquid-glass";
import { cn } from "@/lib/ui/utils";

export function ChatSignedOutView() {
  return (
    <section className="absolute inset-x-4 top-1/2 z-10 mx-auto grid max-w-[620px] -translate-y-1/2 gap-5 text-center">
      <div className={cn(liquidGlass, "rounded-[28px] p-7")}>
        <MessageCircle className="mx-auto mb-4 size-8 text-[rgb(var(--theme-color-rgb))]" />
        <h2 className="text-xl font-semibold text-white">Chat unlocks after sign in</h2>
        <p className="mx-auto mt-3 max-w-[440px] text-sm leading-6 text-white/58">
          Connect your wallet so Sivraj can retrieve only your scoped memory for chat.
        </p>
      </div>
    </section>
  );
}
