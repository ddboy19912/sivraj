import { cn } from "@/lib/ui/utils";

export type AgentStatusHudState = {
  label?: string;
  status?: string;
  active?: boolean;
  progress?: number;
};

type AgentStatusHudProps = AgentStatusHudState & {
  className?: string;
};

const BAR_COUNT = 9;

export function AgentStatusHud({
  label = "AGENT_STATUS",
  status = "IDLE",
  active = false,
  progress,
  className,
}: AgentStatusHudProps) {
  const normalizedProgress =
    typeof progress === "number" ? Math.min(Math.max(progress, 0), 100) : null;

  return (
    <aside
      className={cn(
        "pointer-events-none min-w-[290px] select-none rounded-[42px] border border-white/8 bg-black/36 p-5 opacity-[0.76] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.025),0_0_44px_rgba(var(--theme-color-rgb),0.1)] backdrop-blur-xl transition-[opacity,filter] duration-180 ease-in-out",
        active &&
          "opacity-[0.94] [filter:drop-shadow(0_0_16px_rgba(var(--theme-color-rgb),0.16))]",
        className,
      )}
      aria-label={`${label} ${status}`}
      data-active={active}
      data-fixed-progress={normalizedProgress !== null}
    >
      <div className="flex items-center justify-between gap-8">
        <p className="font-mono text-xs font-bold uppercase tracking-[0.26em] text-white/52">
          {label}
        </p>
        <p className="font-mono text-xs font-bold uppercase tracking-[0.18em] text-[rgb(var(--theme-color-rgb))]">
          {status}
        </p>
      </div>
      <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-[rgba(var(--theme-color-rgb),0.13)]">
        <div
          className="agent-hud-progress h-full rounded-full bg-[rgb(var(--theme-color-rgb))]"
          style={
            normalizedProgress === null
              ? undefined
              : { width: `${normalizedProgress}%` }
          }
        />
      </div>
      <div className="mt-6 flex h-12 items-end gap-3" aria-hidden="true">
        {Array.from({ length: BAR_COUNT }, (_, index) => {
          const key = `bar-${index}`;

          return (
            <span
              key={key}
              className="agent-hud-bar block w-2 rounded-full bg-[rgb(var(--theme-color-rgb))]"
              style={{ animationDelay: `${index * 95}ms` }}
            />
          );
        })}
      </div>
    </aside>
  );
}
