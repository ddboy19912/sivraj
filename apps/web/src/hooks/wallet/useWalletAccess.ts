import { useWalletConnection } from "@mysten/dapp-kit-react";
import { buildWalletAccessResult } from "@/hooks/wallet/use-wallet-access-result";
import { useTwinBootstrap } from "@/hooks/twin-bootstrap/use-twin-bootstrap";
import { useWalletAccessState } from "@/hooks/wallet/use-wallet-access-state";
import { useWalletSessionState } from "@/hooks/wallet/use-wallet-session-state";
import { useWalletSignIn } from "@/hooks/wallet/use-wallet-sign-in";

export function useWalletAccess() {
  const walletConnection = useWalletConnection();
  const account = walletConnection.account;
  const isWalletSettling =
    walletConnection.isConnecting || walletConnection.isReconnecting;

  const sessionState = useWalletSessionState({
    selectedWalletAddress: account?.address,
    isWalletSettling,
  });

  const bootstrapState = useTwinBootstrap({
    session: sessionState.session,
    hasMatchingWalletSession: sessionState.hasMatchingWalletSession,
    setSession: sessionState.setSession,
    resetSession: sessionState.resetSession,
    setAuthError: sessionState.setAuthError,
  });

  const { isSigning, signIn: signInWithAddress } = useWalletSignIn({
    accountAddressRef: sessionState.accountAddressRef,
    setSession: sessionState.setSession,
    setAuthError: sessionState.setAuthError,
  });

  function signIn() {
    if (!account) {
      return;
    }

    signInWithAddress(account.address);
  }

  const accessState = useWalletAccessState({
    accountAddress: account?.address,
    authError: sessionState.authError,
    bootstrap: bootstrapState.bootstrap,
    bootstrapError: bootstrapState.bootstrapError,
    hasMatchingWalletSession: sessionState.hasMatchingWalletSession,
    isBootstrapLoading: bootstrapState.isBootstrapLoading,
    isSigning,
    isWalletSettling,
    refetchBootstrap: bootstrapState.refetchBootstrap,
    session: sessionState.session,
  });

  return buildWalletAccessResult({
    account,
    accessState,
    bootstrap: bootstrapState.bootstrap,
    hasMatchingWalletSession: sessionState.hasMatchingWalletSession,
    session: sessionState.session,
    setSession: sessionState.setSession,
    resetSession: sessionState.resetSession,
    signIn,
    updateBootstrap: bootstrapState.updateBootstrap,
  });
}
