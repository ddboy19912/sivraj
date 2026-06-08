import { useEffect, useEffectEvent, useState } from "react";
import { useWalletSessionCallbacks } from "@/hooks/wallet/use-wallet-session-callbacks";
import { useWalletSessionMutations } from "@/hooks/wallet/use-wallet-session-mutations";
import { addressesMatch } from "@/lib/onboarding/session";
import { resolveActiveSession } from "@/hooks/wallet/wallet-access-resolve";
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
  const mutations = useWalletSessionMutations(callbacks, setSessionState, setAuthError);

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
      isWalletSettling,
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
  }, [isWalletSettling, selectedWalletAddress, session]);

  return {
    accountAddressRef: callbacks.accountAddressRef,
    authError,
    hasMatchingWalletSession,
    resetSession: mutations.resetSession,
    session,
    setAuthError,
    setSession: mutations.setSession,
  };
}
