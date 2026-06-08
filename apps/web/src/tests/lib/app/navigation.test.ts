import { describe, expect, it } from "vitest";
import {
  getNavigationTabForPath,
  getPathForNavigationTab,
} from "@/lib/app/navigation";

describe("app navigation routes", () => {
  it("maps navigation tabs to durable page paths", () => {
    expect(getPathForNavigationTab("home")).toBe("/");
    expect(getPathForNavigationTab("chat")).toBe("/chat");
    expect(getPathForNavigationTab("console")).toBe("/console");
    expect(getPathForNavigationTab("settings")).toBe("/settings");
  });

  it("resolves unknown paths to the home tab", () => {
    expect(getNavigationTabForPath("/")).toBe("home");
    expect(getNavigationTabForPath("/chat")).toBe("chat");
    expect(getNavigationTabForPath("/console")).toBe("console");
    expect(getNavigationTabForPath("/settings")).toBe("settings");
    expect(getNavigationTabForPath("/missing")).toBe("home");
  });
});
