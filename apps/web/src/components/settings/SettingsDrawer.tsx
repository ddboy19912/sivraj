import { ColorPicker } from "@/components/settings/ColorPicker";
import { PortaledWalletConnect } from "@/components/settings/PortaledWalletConnect";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { useMediaQuery } from "@/hooks/common/use-media-query";
import { cn } from "@/lib/ui/utils";

interface SettingsDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SettingsDrawer({ open, onOpenChange }: SettingsDrawerProps) {
  const isLargeScreen = useMediaQuery("(min-width: 768px)");
  const direction = isLargeScreen ? "right" : "bottom";
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
          "overflow-visible",
          direction === "bottom" &&
            "pb-[max(24px,env(safe-area-inset-bottom))]",
          direction === "right" &&
            "pb-[max(24px,env(safe-area-inset-bottom))] pt-5",
        )}
      >
        <DrawerHeader className="border-b border-white/10 pb-5 text-left pt-0!">
          <DrawerTitle className="text-lg font-semibold tracking-tight text-[#f7fdff]">
            Settings
          </DrawerTitle>
        </DrawerHeader>

        <section className="border-b border-white/10 px-4 py-5">
          <p className="mb-3 text-xs font-semibold tracking-[0.08em] text-[rgba(231,252,255,0.48)] uppercase">
            Wallet
          </p>
          {open ? (
            <PortaledWalletConnect />
          ) : (
            <div className="min-h-12 w-full" />
          )}
        </section>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
          <section>
            <p className="mb-3 text-xs font-semibold tracking-[0.08em] text-[rgba(231,252,255,0.48)] uppercase">
              Theme
            </p>
            <ColorPicker />
          </section>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
