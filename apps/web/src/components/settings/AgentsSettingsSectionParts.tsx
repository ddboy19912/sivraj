import {
  LoaderCircle,
  TriangleAlert,
  XCircle,
} from "lucide-react";
import type { ReactNode } from "react";
import { errorMessage } from "@/lib/api";
import { cn } from "@/lib/ui/utils";

export function AgentsUnavailable() {
  return (
    <section>
      <p className="mb-3 text-xs font-semibold tracking-[0.08em] text-white/42 uppercase">
        Agents
      </p>
      <div className="grid min-h-[180px] place-items-center rounded-[18px] border border-white/8 bg-[#05080c]/82 text-center">
        <div className="grid justify-items-center gap-2 px-6">
          <XCircle className="size-5 text-white/38" />
          <p className="text-sm font-medium text-white/56">
            Sign in to export agent context.
          </p>
        </div>
      </div>
    </section>
  );
}

export function ContextStatus({
  error,
  isLoading,
  warnings,
}: {
  error: unknown;
  isLoading: boolean;
  warnings: string[];
}) {
  if (isLoading) {
    return (
      <StatusLine tone="neutral" icon={<LoaderCircle className="size-3.5 animate-spin" />}>
        Loading packet
      </StatusLine>
    );
  }

  if (error) {
    return (
      <StatusLine tone="danger" icon={<XCircle className="size-3.5" />}>
        Context unavailable: {errorMessage(error)}
      </StatusLine>
    );
  }

  if (warnings.length > 0) {
    return (
      <StatusLine tone="warning" icon={<TriangleAlert className="size-3.5" />}>
        {warnings.slice(0, 2).join(", ")}
      </StatusLine>
    );
  }

  return null;
}

function StatusLine({
  children,
  icon,
  tone,
}: {
  children: ReactNode;
  icon: ReactNode;
  tone: "neutral" | "warning" | "danger";
}) {
  return (
    <div
      className={cn(
        "flex min-h-9 items-center gap-2 rounded-[12px] border px-3 py-2 text-xs font-semibold",
        tone === "neutral" && "border-white/8 bg-white/[0.025] text-white/54",
        tone === "warning" && "border-amber-200/18 bg-amber-300/8 text-amber-100/74",
        tone === "danger" && "border-red-200/16 bg-red-300/8 text-red-100/74",
      )}
    >
      {icon}
      <span className="min-w-0 break-words">{children}</span>
    </div>
  );
}
