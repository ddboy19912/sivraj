import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  DEFAULT_THEME_COLOR,
  normalizeHexColor,
} from "@/helpers/color.helpers";

export type ThemeColor = `#${string}`;

const LEGACY_COLOR_IDS: Record<string, ThemeColor> = {
  cyan: DEFAULT_THEME_COLOR,
  green: "#34F5A6",
  violet: "#8C7BFF",
  amber: "#FF9148",
};

type UserSettingsState = {
  themeColor: ThemeColor;
  setThemeColor: (themeColor: string) => void;
};

type PersistedUserSettings = {
  themeColor?: string;
  auraColor?: string;
  auraColorId?: string;
};

export const useUserSettingsStore = create<UserSettingsState>()(
  persist(
    (set) => ({
      themeColor: DEFAULT_THEME_COLOR,
      setThemeColor: (themeColor) =>
        set({ themeColor: normalizeHexColor(themeColor) }),
    }),
    {
      name: "sivraj.user-settings.v1",
      partialize: (state) => ({ themeColor: state.themeColor }),
      merge: (persisted, current) => {
        const saved = persisted as PersistedUserSettings | undefined;

        if (saved?.themeColor) {
          return {
            ...current,
            themeColor: normalizeHexColor(saved.themeColor),
          };
        }

        if (saved?.auraColor) {
          return {
            ...current,
            themeColor: normalizeHexColor(saved.auraColor),
          };
        }

        const legacyColorId = saved?.auraColorId;
        if (legacyColorId) {
          const legacyColor = LEGACY_COLOR_IDS[legacyColorId];

          if (legacyColor) {
            return {
              ...current,
              themeColor: legacyColor,
            };
          }
        }

        return current;
      },
    },
  ),
);
