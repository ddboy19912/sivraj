import {
  Download,
  LoaderCircle,
  RotateCcw,
  TriangleAlert,
  XCircle,
} from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { ClipboardActionButton } from "@/components/ui/clipboard-action-button";
import { errorMessage } from "@/lib/api";
import { describeGrant } from "@/lib/agents/agent-context";
import { cn } from "@/lib/ui/utils";
import type { AgentClientGrant } from "@/types/agent-context.types";

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

export function PacketMetric({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex min-h-14 min-w-0 items-center gap-3 rounded-[14px] border border-white/8 bg-black/18 px-3 py-2.5">
      <span className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-white/[0.045] text-[rgb(var(--theme-color-rgb))]">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-[11px] font-semibold text-white/42">{label}</span>
        <span className="block truncate text-sm font-semibold text-white/84">{value}</span>
      </span>
    </div>
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

export function ActionStrip({
  detail,
  disabled,
  downloadLabel,
  label,
  onDownload,
  value,
}: {
  detail?: string;
  disabled: boolean;
  downloadLabel: string;
  label: string;
  onDownload: () => void;
  value: string;
}) {
  return (
    <div className="flex min-h-14 items-center justify-between gap-3 border-b border-white/7 px-3 py-2.5 last:border-b-0">
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold text-white/82">
          {label}
        </span>
        {detail ? (
          <span className="block truncate text-[11px] font-medium text-white/40">
            {detail}
          </span>
        ) : null}
      </span>
      <span className="flex shrink-0 items-center gap-1">
        <ClipboardActionButton
          action="copy"
          value={value}
          disabled={disabled}
          aria-label={`Copy ${label}`}
          feedbackLabel={`Copied ${label}`}
          className="size-8 rounded-[10px]"
        />
        <Button
          type="button"
          size="icon-sm"
          variant="secondary"
          disabled={disabled}
          aria-label={downloadLabel}
          title={downloadLabel}
          onClick={onDownload}
          className="rounded-[10px]"
        >
          <Download className="size-3.5" />
        </Button>
      </span>
    </div>
  );
}

export function AgentScopeToggle({
  checked,
  description,
  label,
  onChange,
}: {
  checked: boolean;
  description: string;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex min-h-[58px] items-center gap-3 rounded-[14px] border border-white/8 bg-black/16 px-3 py-2.5 transition-colors hover:border-white/14 hover:bg-white/[0.035]">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="size-4 accent-[rgb(var(--theme-color-rgb))]"
      />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-white/80">{label}</span>
        <span className="block truncate text-[11px] font-medium text-white/44">
          {description}
        </span>
      </span>
    </label>
  );
}

export function AgentClientsList({
  clients,
  error,
  isLoading,
  onRevoke,
  revokingGrantId,
}: {
  clients: AgentClientGrant[];
  error: unknown;
  isLoading: boolean;
  onRevoke: (grant: AgentClientGrant) => void;
  revokingGrantId: string | null;
}) {
  return (
    <div className="overflow-hidden rounded-[18px] border border-white/10 bg-[#05080c]/82">
      <div className="flex min-h-14 items-center justify-between gap-3 border-b border-white/8 px-4">
        <h3 className="text-sm font-semibold text-white/86">Active grants</h3>
        {isLoading ? <LoaderCircle className="size-4 animate-spin text-white/40" /> : null}
      </div>

      <div className="p-3">
        {error ? (
          <StatusLine tone="danger" icon={<XCircle className="size-3.5" />}>
            Clients unavailable: {errorMessage(error)}
          </StatusLine>
        ) : clients.length === 0 ? (
          <p className="rounded-[14px] border border-dashed border-white/10 bg-black/14 px-3 py-5 text-sm font-medium text-white/46">
            No agent grants yet.
          </p>
        ) : (
          <div className="grid gap-2">
            {clients.map((grant) => (
              <div
                key={grant.grantId}
                className="flex min-w-0 items-center gap-3 rounded-[14px] border border-white/8 bg-black/16 px-3 py-2.5"
              >
                <span
                  className={cn(
                    "size-2.5 shrink-0 rounded-full",
                    grant.status === "active" && "bg-emerald-200/80",
                    grant.status === "revoked" && "bg-red-200/70",
                    grant.status === "expired" && "bg-white/30",
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-white/82">
                    {grant.name}
                  </span>
                  <span className="block truncate text-[11px] font-medium text-white/42">
                    {describeGrant(grant)}
                  </span>
                </span>
                {grant.status === "active" ? (
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="secondary"
                    disabled={revokingGrantId === grant.grantId}
                    aria-label={`Revoke ${grant.name}`}
                    title={`Revoke ${grant.name}`}
                    onClick={() => onRevoke(grant)}
                    className="rounded-[10px]"
                  >
                    {revokingGrantId === grant.grantId ? (
                      <LoaderCircle className="size-3.5 animate-spin" />
                    ) : (
                      <RotateCcw className="size-3.5" />
                    )}
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
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
