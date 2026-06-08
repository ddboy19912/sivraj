import { create } from "zustand";

type SivrajAppState = {
  providerOpen: boolean;
  settingsOpen: boolean;
  setProviderOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
};

export const useSivrajAppStore = create<SivrajAppState>((set, get) => ({
  providerOpen: false,
  settingsOpen: false,
  setProviderOpen: (providerOpen) => set({ providerOpen }),
  setSettingsOpen: (settingsOpen) => {
    if (get().settingsOpen === settingsOpen) {
      return;
    }

    set({ settingsOpen });
  },
}));
