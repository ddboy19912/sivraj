import { Database } from "lucide-react";
import { formatTime } from "@/lib/chat/chat-formatters";
import { cn } from "@/lib/ui/utils";
import type { ChatMessage } from "@/lib/chat/chat-api";

export function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  const citations = Array.isArray(message.citations) ? message.citations : [];
  const tokenContextSaved =
    typeof message.metadata?.tokenContextSaved === "number"
      ? message.metadata.tokenContextSaved
      : 0;

  return (
    <article className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div className={cn("max-w-[min(100%,680px)]", isUser ? "text-right" : "text-left")}>
        <MessageBubbleHeader isUser={isUser} createdAt={message.createdAt} />
        <div
          className={cn(
            "whitespace-pre-wrap rounded-[24px] border px-5 py-4 text-[0.95rem] leading-7 shadow-[0_20px_50px_rgba(0,0,0,0.22)]",
            isUser
              ? "border-[rgba(var(--theme-color-rgb),0.18)] bg-[rgba(var(--theme-color-rgb),0.08)] text-white/86"
              : "border-white/10 bg-black/16 text-white/78",
          )}
        >
          {message.content}
        </div>
        <MessageBubbleBadges
          isUser={isUser}
          contextSaved={Boolean(message.metadata?.contextSaved)}
          tokenContextSaved={tokenContextSaved}
          citations={citations}
        />
      </div>
    </article>
  );
}

function MessageBubbleHeader({
  isUser,
  createdAt,
}: {
  isUser: boolean;
  createdAt: string;
}) {
  return (
    <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.12em] text-white/38">
      {!isUser ? (
        <Database className="size-3 text-[rgb(var(--theme-color-rgb))]" />
      ) : null}
      <span>{isUser ? "User core" : "Sivraj"}</span>
      <span>{formatTime(createdAt)}</span>
    </div>
  );
}

function MessageBubbleBadges({
  isUser,
  contextSaved,
  tokenContextSaved,
  citations,
}: {
  isUser: boolean;
  contextSaved: boolean;
  tokenContextSaved: number;
  citations: NonNullable<ChatMessage["citations"]>;
}) {
  return (
    <div
      className={cn(
        "mt-2 flex flex-wrap gap-2",
        isUser ? "justify-end" : "justify-start",
      )}
    >
      {isUser && contextSaved ? (
        <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-white/42">
          Context saved
        </span>
      ) : null}
      {!isUser && tokenContextSaved > 0 ? (
        <span className="rounded-full border border-[rgba(var(--theme-color-rgb),0.2)] bg-[rgba(var(--theme-color-rgb),0.08)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-white/52">
          {tokenContextSaved} token context saved
        </span>
      ) : null}
      {citations.map((citation) => (
        <span
          key={citation.id}
          title={citation.sourceArtifactId}
          className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-white/46"
        >
          {citation.label}
        </span>
      ))}
    </div>
  );
}
