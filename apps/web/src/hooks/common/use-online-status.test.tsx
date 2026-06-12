import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useOnlineStatus } from "@/hooks/common/use-online-status";

const setNavigatorOnline = (isOnline: boolean) => {
  Object.defineProperty(window.navigator, "onLine", {
    configurable: true,
    get: () => isOnline,
  });
};

describe("useOnlineStatus", () => {
  afterEach(() => {
    setNavigatorOnline(true);
  });

  it("returns the initial browser online status", () => {
    setNavigatorOnline(false);

    const { result } = renderHook(() => useOnlineStatus());

    expect(result.current).toBe(false);
  });

  it("updates when the browser online status changes", () => {
    setNavigatorOnline(true);
    const { result } = renderHook(() => useOnlineStatus());

    expect(result.current).toBe(true);

    setNavigatorOnline(false);
    act(() => window.dispatchEvent(new Event("offline")));
    expect(result.current).toBe(false);

    setNavigatorOnline(true);
    act(() => window.dispatchEvent(new Event("online")));
    expect(result.current).toBe(true);
  });
});
