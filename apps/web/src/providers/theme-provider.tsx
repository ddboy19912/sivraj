import { type ReactNode, useLayoutEffect } from "react";
import { hexToRgbChannels } from "@/helpers/color.helpers";
import { ThemeContext } from "@/providers/theme-context";
import { useUserSettingsStore } from "@/stores/user-settings";

export function ThemeProvider({ children }: { children: ReactNode }) {
  const color = useUserSettingsStore((state) => state.themeColor);
  const setColor = useUserSettingsStore((state) => state.setThemeColor);
  const rgb = hexToRgbChannels(color);

  useLayoutEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--theme-color", color);
    root.style.setProperty("--theme-color-rgb", rgb);

    return () => {
      root.style.removeProperty("--theme-color");
      root.style.removeProperty("--theme-color-rgb");
    };
  }, [color, rgb]);

  const value = { color, rgb, setColor };

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}
