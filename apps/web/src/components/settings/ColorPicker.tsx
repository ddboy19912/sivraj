import { HexColorInput, HexColorPicker } from "react-colorful";
import { useTheme } from "@/providers/theme-context";
import { cn } from "@/lib/ui/utils";

type ColorPickerProps = {
  className?: string;
};

export function ColorPicker({ className }: ColorPickerProps) {
  const { color, setColor } = useTheme();

  return (
    <div className={cn("theme-color-picker space-y-4", className)}>
      <div className="overflow-hidden rounded-[22px] border border-white/12 bg-black/20 p-3 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)]">
        <HexColorPicker color={color} onChange={setColor} />
      </div>

      <div className="flex items-end gap-3">
        <span
          className="size-11 shrink-0 rounded-2xl border border-white/20 shadow-[0_0_24px_currentColor]"
          style={{ background: color, color }}
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <label
            htmlFor="theme-color-input"
            className="mb-1.5 block text-[11px] font-semibold tracking-[0.08em] text-[rgba(231,252,255,0.48)] uppercase"
          >
            Hex
          </label>
          <HexColorInput
            id="theme-color-input"
            color={color}
            onChange={setColor}
            prefixed
            className="w-full rounded-[14px] border border-white/14 bg-white/5 px-[0.85rem] py-[0.7rem] font-mono text-sm tracking-[0.04em] text-[#f7fdff] outline-none focus:border-[rgba(var(--theme-color-rgb),0.45)] focus:shadow-[0_0_0_3px_rgba(var(--theme-color-rgb),0.16)]"
            aria-label="Theme color hex value"
          />
        </div>
      </div>
    </div>
  );
}
