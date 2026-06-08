import type { NavigationTabId } from "@/components/navigation/NavigationTab";

const ROUTE_BY_TAB: Record<NavigationTabId, string> = {
  home: "/",
  chat: "/chat",
  console: "/console",
  settings: "/settings",
};

export function getPathForNavigationTab(tab: NavigationTabId): string {
  return ROUTE_BY_TAB[tab];
}

export function getNavigationTabForPath(pathname: string): NavigationTabId {
  if (pathname === "/chat") {
    return "chat";
  }

  if (pathname === "/console") {
    return "console";
  }

  if (pathname === "/settings") {
    return "settings";
  }

  return "home";
}
