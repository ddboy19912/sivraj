import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_THEME_COLOR } from "@/helpers/color.helpers";
import { useUserSettingsStore } from "@/stores/user-settings";

describe("useUserSettingsStore", () => {
  beforeEach(() => {
    localStorage.clear();
    useUserSettingsStore.setState({ themeColor: DEFAULT_THEME_COLOR });
  });

  it("normalizes theme colors on update", () => {
    useUserSettingsStore.getState().setThemeColor("#AABBCC");
    expect(useUserSettingsStore.getState().themeColor).toBe("#AABBCC");
  });

  it("restores persisted theme colors", () => {
    localStorage.setItem(
      "sivraj.user-settings.v1",
      JSON.stringify({ state: { themeColor: "#112233" }, version: 0 }),
    );

    useUserSettingsStore.persist.rehydrate();
    expect(useUserSettingsStore.getState().themeColor).toBe("#112233");
  });

  it("migrates legacy auraColor persistence", () => {
    localStorage.setItem(
      "sivraj.user-settings.v1",
      JSON.stringify({ state: { auraColor: "#34F5A6" }, version: 0 }),
    );

    useUserSettingsStore.persist.rehydrate();
    expect(useUserSettingsStore.getState().themeColor).toBe("#34F5A6");
  });

  it("migrates legacy auraColorId persistence", () => {
    localStorage.setItem(
      "sivraj.user-settings.v1",
      JSON.stringify({ state: { auraColorId: "violet" }, version: 0 }),
    );

    useUserSettingsStore.persist.rehydrate();
    expect(useUserSettingsStore.getState().themeColor).toBe("#8C7BFF");
  });
});
