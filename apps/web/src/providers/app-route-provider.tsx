import type { ReactNode } from "react";
import {
  AppRouteContext,
  type AppRouteContextValue,
} from "@/providers/app-route-context";

type AppRouteContextProviderProps = {
  children: ReactNode;
  value: AppRouteContextValue;
};

export function AppRouteContextProvider({
  children,
  value,
}: AppRouteContextProviderProps) {
  return (
    <AppRouteContext.Provider value={value}>
      {children}
    </AppRouteContext.Provider>
  );
}
