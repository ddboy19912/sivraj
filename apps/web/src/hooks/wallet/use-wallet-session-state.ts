import { useEffect, useEffectEvent, useState } from "react";
import { useWalletSessionCallbacks } from "@/hooks/wallet/use-wallet-session-callbacks";
import { useWalletSessionMutations } from "@/hooks/wallet/use-wallet-session-mutations";
import { addressesMatch } from "@/lib/onboarding/session";
import {
  resolveActiveSession,
  resolveWalletSessionRestoreStatus,
  shouldHoldStoredSessionForWalletRestore,
} from "@/hooks/wallet/wallet-access-resolve";
import { readStoredSession, type Session } from "@/lib/session";

export const DAPP_KIT_SELECTED_WALLET_STORAGE_KEY =
  "mysten-dapp-kit:selected-wallet-and-address";
export const WALLET_SESSION_RESTORE_TIMEOUT_MS = 2500;

type WalletSessionStateInput = {
  selectedWalletAddress: string | null | undefined;
  isWalletSettling: boolean;
};

export function useWalletSessionState({
  selectedWalletAddress,
  isWalletSettling,
}: WalletSessionStateInput) {
  const callbacks = useWalletSessionCallbacks(selectedWalletAddress);
  const [session, setSessionState] = useState<Session | null>(readStoredSession);
  const [authError, setAuthError] = useState<string | null>(null);
  const mutations = useWalletSessionMutations(callbacks, setSessionState, setAuthError);
  const storedWalletAddress = readStoredDAppKitWalletAddress();
  const restoreKey = [
    selectedWalletAddress ?? "",
    session?.walletAddress ?? "",
    storedWalletAddress ?? "",
  ].join(":");
  const [restoreTimeout, setRestoreTimeout] = useState(() => ({
    hasTimedOut: false,
    key: restoreKey,
  }));

  if (restoreTimeout.key !== restoreKey) {
    setRestoreTimeout({ hasTimedOut: false, key: restoreKey });
  }

  const hasRestoreTimedOut =
    restoreTimeout.key === restoreKey && restoreTimeout.hasTimedOut;
  const walletRestoreStatus = resolveWalletSessionRestoreStatus({
    activeSession: session,
    hasTimedOut: hasRestoreTimedOut,
    selectedWalletAddress: selectedWalletAddress ?? null,
    storedWalletAddress,
  });
  const isWalletSessionRestorePending = shouldHoldStoredSessionForWalletRestore({
    activeSession: session,
    hasTimedOut: hasRestoreTimedOut,
    selectedWalletAddress: selectedWalletAddress ?? null,
    storedWalletAddress,
  });
  const shouldHoldActiveSession =
    isWalletSettling || isWalletSessionRestorePending;

  const hasMatchingWalletSession = Boolean(
    selectedWalletAddress &&
      session &&
      addressesMatch(session.walletAddress, selectedWalletAddress),
  );

  const resolveSession = useEffectEvent(() => {
    const resolution = resolveActiveSession({
      selectedWalletAddress: selectedWalletAddress ?? null,
      activeSession: session,
      storedSession: readStoredSession(),
      isWalletSettling: shouldHoldActiveSession,
    });

    if (resolution.status === "clear_active") {
      mutations.clearActiveSession();
      return;
    }

    if (resolution.status === "restore_stored") {
      mutations.setSession(resolution.session);
    }
  });

  useEffect(() => {
    resolveSession();
  }, [selectedWalletAddress, session, shouldHoldActiveSession]);

  useEffect(() => {
    if (!isWalletSessionRestorePending) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setRestoreTimeout((current) =>
        current.key === restoreKey
          ? { ...current, hasTimedOut: true }
          : current,
      );
    }, WALLET_SESSION_RESTORE_TIMEOUT_MS);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [
    isWalletSessionRestorePending,
    restoreKey,
  ]);

  return {
    accountAddressRef: callbacks.accountAddressRef,
    authError,
    hasMatchingWalletSession,
    isWalletSessionRestorePending,
    resetSession: mutations.resetSession,
    session,
    setAuthError,
    setSession: mutations.setSession,
    walletRestoreStatus,
  };
}

function readStoredDAppKitWalletAddress() {
  if (typeof window === "undefined") {
    return null;
  }

  return parseStoredDAppKitWalletAddress(
    window.localStorage.getItem(DAPP_KIT_SELECTED_WALLET_STORAGE_KEY),
  );
}

export function parseStoredDAppKitWalletAddress(raw: string | null) {
  if (!raw) {
    return null;
  }

  const [, walletAddress] = raw.split(":");

  return walletAddress || null;
}
