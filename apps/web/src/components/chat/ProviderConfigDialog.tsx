import { Cpu } from "lucide-react";
import { ProviderConfigDialogBody } from "@/components/chat/ProviderConfigDialogBody";
import { ProviderConfigDialogFooter } from "@/components/chat/ProviderConfigDialogFooter";
import { buildProviderConfigDialogFormProps } from "@/lib/chat/provider-config-dialog-form-props";
import { useProviderConfigDialog } from "@/hooks/chat/use-provider-config-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Session } from "@/lib/session";
import type { ProviderConfigResponse } from "@/lib/chat/chat-api";

type ProviderConfigDialogProps = {
  open: boolean;
  session: Session | null;
  onOpenChange: (open: boolean) => void;
  onSessionRefreshed: (session: Session) => void;
  onProviderChanged: (response: ProviderConfigResponse | null) => void;
};

export function ProviderConfigDialog({
  open,
  session,
  onOpenChange,
  onSessionRefreshed,
  onProviderChanged,
}: ProviderConfigDialogProps) {
  const config = useProviderConfigDialog({
    open,
    session,
    onSessionRefreshed,
    onProviderChanged,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent variant="ambient" className="max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[#f7fdff]">
            <Cpu className="size-5 text-[rgb(var(--theme-color-rgb))]" />
            LLM provider
          </DialogTitle>
          <DialogDescription className="text-[rgba(231,252,255,0.62)]">
            Model: OpenAI-compatible. Memory: Sivraj.
          </DialogDescription>
        </DialogHeader>

        <ProviderConfigDialogBody
          session={session}
          formProps={buildProviderConfigDialogFormProps(config)}
        />

        <DialogFooter className="sm:justify-between">
          <ProviderConfigDialogFooter
            session={session}
            canSubmit={config.canSubmit}
            isBusy={config.isBusy}
            onDisconnect={config.handleDisconnect}
            onTest={config.handleTest}
            onSave={config.handleSave}
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
