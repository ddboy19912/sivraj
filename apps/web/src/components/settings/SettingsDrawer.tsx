import { useState } from "react";
import { ColorPicker } from "@/components/settings/ColorPicker";
import { PortaledWalletConnect } from "@/components/settings/PortaledWalletConnect";
import { TelegramSettingsSection } from "@/components/settings/TelegramSettingsSection";
import { VoiceSettingsSection } from "@/components/settings/VoiceSettingsSection";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { useMediaQuery } from "@/hooks/common/use-media-query";
import type { ProviderConfigResponse } from "@/lib/chat/chat-api";
import type { Session } from "@/lib/session";
import { cn } from "@/lib/ui/utils";

type SettingsTab = "account" | "integrations" | "voice" | "appearance";

const SETTINGS_TABS: Array<{ id: SettingsTab; label: string }> = [
  { id: "account", label: "Account" },
  { id: "integrations", label: "Apps" },
  { id: "voice", label: "Voice" },
  { id: "appearance", label: "Appearance" },
];

interface SettingsDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: Session | null;
  providerState: ProviderConfigResponse | null;
  onProviderStateChange: (state: ProviderConfigResponse | null) => void;
  onSessionRefreshed: (session: Session) => void;
}

export function SettingsDrawer({
  open,
  onOpenChange,
  session,
  providerState,
  onProviderStateChange,
  onSessionRefreshed,
}: SettingsDrawerProps) {
  const isLargeScreen = useMediaQuery("(min-width: 768px)");
  const direction = isLargeScreen ? "right" : "bottom";
  const [activeTab, setActiveTab] = useState<SettingsTab>("account");

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
          "overflow-visible data-[vaul-drawer-direction=right]:min-w-lg",
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
          <DrawerDescription className="sr-only">
            Manage account, apps, voice, and appearance settings.
          </DrawerDescription>
        </DrawerHeader>

        <div className="border-b border-white/10 px-4 py-3">
          <div
            className="grid grid-cols-4 rounded-2xl border border-white/10 bg-white/[0.035] p-1"
            role="tablist"
            aria-label="Settings categories"
          >
            {SETTINGS_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={activeTab === tab.id}
                className={cn(
                  "h-9 rounded-xl px-3 text-sm font-medium text-white/56 transition focus-visible:ring-3 focus-visible:ring-[rgba(var(--theme-color-rgb),0.2)] focus-visible:outline-none",
                  activeTab === tab.id &&
                    "bg-[rgba(var(--theme-color-rgb),0.16)] text-white shadow-[0_0_20px_rgba(var(--theme-color-rgb),0.08)]",
                )}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
          {activeTab === "account" ? (
            <section>
              <p className="mb-3 text-xs font-semibold tracking-[0.08em] text-[rgba(231,252,255,0.48)] uppercase">
                Wallet
              </p>
              {open ? (
                <PortaledWalletConnect />
              ) : (
                <div className="min-h-12 w-full" />
              )}
            </section>
          ) : null}

          {activeTab === "voice" ? (
            <VoiceSettingsSection
              session={session}
              providerState={providerState}
              onProviderStateChange={onProviderStateChange}
              onSessionRefreshed={onSessionRefreshed}
            />
          ) : null}

          {activeTab === "integrations" ? (
            <TelegramSettingsSection
              session={session}
              onSessionRefreshed={onSessionRefreshed}
            />
          ) : null}

          {activeTab === "appearance" ? (
            <section>
              <p className="mb-3 text-xs font-semibold tracking-[0.08em] text-[rgba(231,252,255,0.48)] uppercase">
                Theme
              </p>
              <ColorPicker />
            </section>
          ) : null}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
