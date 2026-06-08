import { Outlet, useLocation, useNavigate } from "react-router";
import { ProviderConfigDialog } from "@/components/chat/ProviderConfigDialog";
import { AppGlobalOverlay } from "@/components/app/AppGlobalOverlay";
import { TwinSpeechPlayer } from "@/components/app/TwinSpeechPlayer";
import { AOSInit } from "@/components/common/AOSInit";
import { Navbar } from "@/components/navigation/Navbar";
import {
  NavigationTab,
  type NavigationTabId,
} from "@/components/navigation/NavigationTab";
import { SettingsDrawer } from "@/components/settings/SettingsDrawer";
import { useSivrajAppState } from "@/hooks/app/useSivrajAppState";
import {
  getNavigationTabForPath,
  getPathForNavigationTab,
} from "@/lib/app/navigation";
import { AppRouteContextProvider } from "@/providers/app-route-provider";

export function AppLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const activeTab = getNavigationTabForPath(location.pathname);
  const app = useSivrajAppState(activeTab);
  const settingsOpen = activeTab === "settings" || app.settingsOpen;

  function selectTab(tab: NavigationTabId) {
    if (tab !== "settings") {
      app.setSettingsOpen(false);
    }

    if (tab === "settings") {
      app.setSettingsOpen(true);
    }

    navigate(getPathForNavigationTab(tab));
  }

  function setSettingsOpen(open: boolean) {
    app.setSettingsOpen(open);

    if (open && activeTab !== "settings") {
      navigate(getPathForNavigationTab("settings"));
      return;
    }

    if (!open && activeTab === "settings") {
      navigate(getPathForNavigationTab("home"), { replace: true });
    }
  }

  return (
    <main className="ambient-ui-page absolute inset-0 isolate min-h-svh min-w-[320px] overflow-hidden text-[#f6feff]">
      <AOSInit />
      <Navbar
        onProviderClick={() => app.setProviderOpen(true)}
        providerStatus={app.providerStatus}
      />
      <SettingsDrawer open={settingsOpen} onOpenChange={setSettingsOpen} />
      <ProviderConfigDialog
        open={app.providerOpen}
        session={app.onboarding.session}
        onOpenChange={app.setProviderOpen}
        onSessionRefreshed={app.onboarding.setSession}
        onProviderChanged={app.setProviderState}
      />
      <NavigationTab activeTab={activeTab} onTabChange={selectTab} />
      <div
        className="ambient-ui-dot-grid pointer-events-none absolute inset-0"
        aria-hidden="true"
      />
      <AppRouteContextProvider
        value={{
          homeAgentState: app.homeAgentState,
          homeStatusHud: app.homeStatusHud,
          onboarding: app.onboarding,
          providerState: app.providerState,
          setProviderOpen: app.setProviderOpen,
          setProviderState: app.setProviderState,
        }}
      >
        <Outlet />
      </AppRouteContextProvider>
      <TwinSpeechPlayer
        command={app.twinRuntime.speechPlaybackCommand}
        onRuntimeEvent={app.twinRuntime.dispatchRuntimeEvent}
        onPlaybackCompleted={app.twinRuntime.consumeRuntimeEvent}
      />
      <AppGlobalOverlay flow={app.onboarding} overlay={app.appOverlay} />
    </main>
  );
}
