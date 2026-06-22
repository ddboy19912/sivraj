import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DAPP_KIT_SELECTED_WALLET_STORAGE_KEY,
  parseStoredDAppKitWalletAddress,
  useWalletSessionState,
  WALLET_SESSION_RESTORE_TIMEOUT_MS,
} from "@/hooks/wallet/use-wallet-session-state";
import { storeSession, type Session } from "@/lib/session";

const session: Session = {
  token: "token",
  refreshToken: "refresh-token",
  expiresAt: "2026-06-04T20:22:22.384Z",
  twinId: "twin",
  walletAddress: "0x123",
};

describe("useWalletSessionState", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    localStorage.clear();
  });

  it("keeps a matching persisted wallet restore pending beyond one frame", () => {
    storeSession(session);
    storeDAppKitWalletAddress(session.walletAddress);

    const { result, rerender } = renderUseWalletSessionState(null);

    expect(result.current.session).toMatchObject({
      walletAddress: session.walletAddress,
    });
    expect(result.current.isWalletSessionRestorePending).toBe(true);
    expect(result.current.walletRestoreStatus).toBe("pending");

    act(() => {
      vi.advanceTimersByTime(16);
    });

    expect(result.current.isWalletSessionRestorePending).toBe(true);
    expect(result.current.walletRestoreStatus).toBe("pending");

    rerender({ selectedWalletAddress: session.walletAddress });

    expect(result.current.isWalletSessionRestorePending).toBe(false);
    expect(result.current.walletRestoreStatus).toBe("resolved");
    expect(result.current.hasMatchingWalletSession).toBe(true);
  });

  it("falls back after the restore timeout when no wallet account appears", () => {
    storeSession(session);
    storeDAppKitWalletAddress(session.walletAddress);

    const { result } = renderUseWalletSessionState(null);

    expect(result.current.isWalletSessionRestorePending).toBe(true);

    act(() => {
      vi.advanceTimersByTime(WALLET_SESSION_RESTORE_TIMEOUT_MS - 1);
    });

    expect(result.current.isWalletSessionRestorePending).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1);
    });

    expect(result.current.isWalletSessionRestorePending).toBe(false);
    expect(result.current.session).toBeNull();
    expect(result.current.walletRestoreStatus).toBe("idle");
  });
});

describe("parseStoredDAppKitWalletAddress", () => {
  it("reads the wallet address from dapp-kit persisted wallet storage", () => {
    expect(parseStoredDAppKitWalletAddress("wallet-id:0x123:sui")).toBe("0x123");
  });

  it("returns null for empty or malformed storage", () => {
    expect(parseStoredDAppKitWalletAddress(null)).toBeNull();
    expect(parseStoredDAppKitWalletAddress("wallet-id")).toBeNull();
  });
});

function renderUseWalletSessionState(selectedWalletAddress: string | null) {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });

  return renderHook(
    ({ selectedWalletAddress: walletAddress }) =>
      useWalletSessionState({
        isWalletSettling: false,
        selectedWalletAddress: walletAddress,
      }),
    {
      initialProps: { selectedWalletAddress },
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      ),
    },
  );
}

function storeDAppKitWalletAddress(walletAddress: string) {
  localStorage.setItem(
    DAPP_KIT_SELECTED_WALLET_STORAGE_KEY,
    `wallet-id:${walletAddress}:sui`,
  );
}
