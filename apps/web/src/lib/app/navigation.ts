import type { NavigationTabId } from "@/components/navigation/NavigationTab";

const ROUTE_BY_TAB: Record<NavigationTabId, string> = {
  home: "/",
  chat: "/chat",
  settings: "/settings",
};

export function getPathForNavigationTab(tab: NavigationTabId): string {
  return ROUTE_BY_TAB[tab];
}

export function getNavigationTabForPath(pathname: string): NavigationTabId {
  if (pathname === "/chat") {
    return "chat";
  }

  if (pathname === "/settings") {
    return "settings";
  }

  return "home";
}
