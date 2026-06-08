import { useWalletSessionCallbacks } from "@/hooks/wallet/use-wallet-session-callbacks";
import type { Session } from "@/lib/session";

export function useWalletSessionMutations(
  callbacks: ReturnType<typeof useWalletSessionCallbacks>,
  setSessionState: React.Dispatch<React.SetStateAction<Session | null>>,
  setAuthError: React.Dispatch<React.SetStateAction<string | null>>,
) {
  function setSession(nextSession: Session) {
    const stored = callbacks.setSession(nextSession);
    if (!stored) {
      return;
    }

    setSessionState(stored);
    setAuthError(null);
  }

  function resetSession() {
    callbacks.resetSession();
    setSessionState(null);
    setAuthError(null);
  }

  function clearActiveSession() {
    setSessionState(null);
    setAuthError(null);
    callbacks.clearBootstrapQueries();
  }

  return { clearActiveSession, resetSession, setSession };
}
