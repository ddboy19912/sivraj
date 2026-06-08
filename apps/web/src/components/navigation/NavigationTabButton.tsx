import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/ui/utils";
import type { NavigationTabId } from "@/components/navigation/NavigationTab";

type NavigationTabButtonProps = {
  id: NavigationTabId;
  label: string;
  icon: LucideIcon;
  isActive: boolean;
  onSelect: (tab: NavigationTabId) => void;
};

export function NavigationTabButton({
  id,
  label,
  icon: Icon,
  isActive,
  onSelect,
}: NavigationTabButtonProps) {
  return (
    <li className="min-w-0 flex-1">
      <button
        type="button"
        aria-current={isActive ? "page" : undefined}
        aria-label={label}
        onClick={() => onSelect(id)}
        className={cn(
          "flex w-full flex-col items-center gap-1 rounded-[22px] px-2 py-2.5 transition-[background-color,box-shadow,color,transform] duration-300 ease-out",
          isActive
            ? "scale-[1.02] bg-[rgba(var(--theme-color-rgb),0.18)] text-[#f7fdff] shadow-[inset_0_0_0_1px_rgba(var(--theme-color-rgb),0.3),0_0_22px_rgba(var(--theme-color-rgb),0.14)]"
            : "text-[rgba(231,252,255,0.58)] hover:bg-white/4 hover:text-[rgba(231,252,255,0.86)]",
        )}
      >
        <Icon
          className={cn(
            "size-5 shrink-0",
            isActive && "drop-shadow-[0_0_10px_rgba(var(--theme-color-rgb),0.5)]",
          )}
          strokeWidth={isActive ? 2.25 : 1.9}
        />
        <span className="truncate text-[10px] font-semibold tracking-[0.02em]">
          {label}
        </span>
      </button>
    </li>
  );
}
