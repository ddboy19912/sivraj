import { useEffect, useEffectEvent, useState, useSyncExternalStore } from "react";
import { useWalletSessionCallbacks } from "@/hooks/wallet/use-wallet-session-callbacks";
import { useWalletSessionMutations } from "@/hooks/wallet/use-wallet-session-mutations";
import { addressesMatch } from "@/lib/onboarding/session";
import {
  resolveActiveSession,
  shouldHoldStoredSessionForWalletRestore,
} from "@/hooks/wallet/wallet-access-resolve";
import { readStoredSession, type Session } from "@/lib/session";

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
  const hasObservedWalletConnection = useSyncExternalStore(
    subscribeToWalletConnectionObservation,
    readWalletConnectionObservation,
    readServerWalletConnectionObservation,
  );
  const mutations = useWalletSessionMutations(callbacks, setSessionState, setAuthError);
  const isSessionRestorePending = shouldHoldStoredSessionForWalletRestore({
    selectedWalletAddress: selectedWalletAddress ?? null,
    activeSession: session,
    hasObservedWalletConnection,
  });
  const shouldHoldActiveSession = isWalletSettling || isSessionRestorePending;

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

  return {
    accountAddressRef: callbacks.accountAddressRef,
    authError,
    hasMatchingWalletSession,
    isSessionRestorePending,
    resetSession: mutations.resetSession,
    session,
    setAuthError,
    setSession: mutations.setSession,
  };
}

let hasObservedWalletConnectionSnapshot = false;
const walletConnectionObservationListeners = new Set<() => void>();

function subscribeToWalletConnectionObservation(onStoreChange: () => void) {
  walletConnectionObservationListeners.add(onStoreChange);

  if (hasObservedWalletConnectionSnapshot) {
    return () => {
      walletConnectionObservationListeners.delete(onStoreChange);
    };
  }

  const frame = window.requestAnimationFrame(() => {
    hasObservedWalletConnectionSnapshot = true;
    walletConnectionObservationListeners.forEach((listener) => listener());
  });

  return () => {
    window.cancelAnimationFrame(frame);
    walletConnectionObservationListeners.delete(onStoreChange);
  };
}

function readWalletConnectionObservation() {
  return hasObservedWalletConnectionSnapshot;
}

function readServerWalletConnectionObservation() {
  return false;
}
