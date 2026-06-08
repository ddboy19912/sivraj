import { createContext, use } from "react";
import type { ThemeColor } from "@/stores/user-settings";

export type Theme = {
  color: ThemeColor;
  rgb: string;
  setColor: (color: string) => void;
};

export const ThemeContext = createContext<Theme | null>(null);

export function useTheme(): Theme {
  const context = use(ThemeContext);

  if (!context) {
    throw new Error("useTheme must be used within ThemeProvider");
  }

  return context;
}
