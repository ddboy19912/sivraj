import { ClipboardPaste, Copy } from "lucide-react";
import type * as React from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useClipboard, type ClipboardStatus } from "@/hooks/useClipboard";
import { cn } from "@/lib/ui/utils";

type ClipboardActionButtonProps = Omit<React.ComponentProps<"button">, "children" | "onClick"> & {
  action: "copy" | "paste";
  value?: string;
  onClipboardPaste?: (value: string) => boolean | void;
  onFailure?: (status: ClipboardStatus) => void;
  feedbackLabel?: string;
  iconClassName?: string;
};

export function ClipboardActionButton({
  action,
  value = "",
  onClipboardPaste,
  onFailure,
  feedbackLabel,
  className,
  iconClassName,
  disabled,
  "aria-label": ariaLabel,
  ...props
}: ClipboardActionButtonProps) {
  const clipboard = useClipboard();
  const isOpen = clipboard.status !== "idle";
  const label = feedbackLabel ?? (action === "copy" ? "Copied" : "Pasted");
  const Icon = action === "copy" ? Copy : ClipboardPaste;

  async function handleAction() {
    if (action === "copy") {
      const didCopy = await clipboard.copy(value);
      if (!didCopy) {
        onFailure?.(clipboard.status);
      }
      return;
    }

    const text = await clipboard.read();
    if (text === null) {
      onFailure?.(clipboard.status);
      return;
    }

    const didAcceptPaste = onClipboardPaste?.(text);
    clipboard.showStatus(didAcceptPaste === false ? "failed" : "pasted");
  }

  return (
    <Popover open={isOpen} onOpenChange={(nextOpen) => {
      if (!nextOpen) {
        clipboard.reset();
      }
    }}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={ariaLabel ?? (action === "copy" ? "Copy" : "Paste")}
          disabled={disabled}
          onClick={() => void handleAction()}
          className={cn(
            "grid size-7 place-items-center rounded-full text-white/30 transition hover:bg-white/7 hover:text-white/72 focus-visible:bg-white/7 focus-visible:text-white/72 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50",
            className,
          )}
          {...props}
        >
          <Icon className={cn("size-3.5", iconClassName)} />
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" className="pointer-events-none">
        {clipboard.status === "copied" || clipboard.status === "pasted"
          ? label
          : clipboard.status === "unsupported"
            ? "Clipboard unavailable"
            : "Clipboard failed"}
      </PopoverContent>
    </Popover>
  );
}
