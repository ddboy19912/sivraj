import { Cpu } from "lucide-react";
import { ProviderConfigDialogBody } from "@/components/chat/ProviderConfigDialogBody";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { useProviderConfigDialog } from "@/hooks/chat/use-provider-config-dialog";
import { useMediaQuery } from "@/hooks/common/use-media-query";
import type { ProviderConfigResponse } from "@/lib/chat/chat-api";
import { buildProviderConfigDialogFormProps } from "@/lib/chat/provider-config-dialog-form-props";
import type { Session } from "@/lib/session";
import { cn } from "@/lib/ui/utils";

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
  const isLargeScreen = useMediaQuery("(min-width: 768px)");
  const direction = isLargeScreen ? "right" : "bottom";
  const config = useProviderConfigDialog({
    open,
    session,
    onSessionRefreshed,
    onProviderChanged,
  });

  return (
    <Drawer
      key={direction}
      open={open}
      onOpenChange={onOpenChange}
      direction={direction}
      modal
    >
      <DrawerContent
        className={cn(
          "overflow-hidden",
          direction === "right" && "max-w-[min(520px,calc(100vw-28px))] pt-5",
          direction === "bottom" &&
            "max-h-[min(86svh,760px)] pb-[max(18px,env(safe-area-inset-bottom))]",
        )}
      >
        <DrawerHeader className="border-b border-white/6 pb-4 text-left pt-0!">
          <DrawerTitle className="flex items-center gap-2.5 text-base font-semibold tracking-tight text-white/90">
            <Cpu className="size-4.5 text-[rgba(var(--theme-color-rgb),0.7)]" />
            Chat model
          </DrawerTitle>
        </DrawerHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 pb-8">
          <ProviderConfigDialogBody
            session={session}
            formProps={buildProviderConfigDialogFormProps(config)}
          />
        </div>
      </DrawerContent>
    </Drawer>
  );
}
