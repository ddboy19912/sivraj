import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { addressesMatch } from "@/lib/onboarding/session";
import {
  clearSession,
  readStoredSession,
  storeSession,
  type Session,
} from "@/lib/session";

export function useWalletSessionCallbacks(
  selectedWalletAddress: string | null | undefined,
) {
  const queryClient = useQueryClient();
  const accountAddressRef = useRef<string | null>(selectedWalletAddress ?? null);

  useEffect(() => {
    accountAddressRef.current = selectedWalletAddress ?? null;
  }, [selectedWalletAddress]);

  function setSession(nextSession: Session) {
    const walletAddress = accountAddressRef.current;

    if (walletAddress && !addressesMatch(nextSession.walletAddress, walletAddress)) {
      return;
    }

    storeSession(nextSession);
    return nextSession;
  }

  function resetSession() {
    clearSession();
    void queryClient.cancelQueries({ queryKey: ["twin-bootstrap"] });
    queryClient.removeQueries({ queryKey: ["twin-bootstrap"] });
  }

  function clearBootstrapQueries() {
    void queryClient.cancelQueries({ queryKey: ["twin-bootstrap"] });
  }

  return {
    accountAddressRef,
    clearBootstrapQueries,
    readStoredSession,
    resetSession,
    setSession,
  };
}
