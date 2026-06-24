import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/ui/utils";

type ConfirmationDialogTone = "default" | "destructive";

type ConfirmationDialogProps = {
  cancelLabel?: string;
  children?: ReactNode;
  confirmLabel: string;
  description?: string;
  isPending?: boolean;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  title: string;
  tone?: ConfirmationDialogTone;
};

export function ConfirmationDialog({
  cancelLabel = "Cancel",
  children,
  confirmLabel,
  description,
  isPending = false,
  onConfirm,
  onOpenChange,
  open,
  title,
  tone = "default",
}: ConfirmationDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[420px] rounded-[16px]">
        <DialogHeader>
          <DialogTitle className="pr-3 text-base">{title}</DialogTitle>
          {description ? (
            <DialogDescription className="leading-5">
              {description}
            </DialogDescription>
          ) : null}
        </DialogHeader>
        {children ? (
          <div className="border-b border-white/[0.06] px-5 py-4">
            {children}
          </div>
        ) : null}
        <div className="flex justify-end gap-2 px-5 py-4">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={isPending}
            onClick={() => onOpenChange(false)}
            className="h-9 rounded-[4px] border-white/10 bg-white/[0.035] px-3 text-white/66 hover:bg-white/[0.07] hover:text-white/86"
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={isPending}
            onClick={onConfirm}
            className={cn(
              "h-9 rounded-[4px] px-3",
              tone === "default" &&
                "border-[rgba(var(--theme-color-rgb),0.44)] bg-[rgba(var(--theme-color-rgb),0.14)] text-[rgb(var(--theme-color-rgb))] hover:bg-[rgba(var(--theme-color-rgb),0.2)]",
              tone === "destructive" &&
                "border-red-200/18 bg-red-300/10 text-red-100/78 hover:bg-red-300/16 hover:text-red-100",
            )}
          >
            {confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
