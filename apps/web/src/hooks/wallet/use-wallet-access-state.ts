import { hasCompletedOnboardingForWallet } from "@/lib/onboarding/completion";
import { resolveWalletAccessState } from "@/hooks/wallet/wallet-access-resolve";
import type { TwinBootstrap } from "@/types/wallet.types";
import type { Session } from "@/lib/session";

type WalletAccessStateInput = {
  accountAddress: string | undefined;
  authError: string | null;
  bootstrap: TwinBootstrap | null;
  bootstrapError: Error | null;
  hasMatchingWalletSession: boolean;
  isBootstrapLoading: boolean;
  isSigning: boolean;
  isWalletSessionRestorePending: boolean;
  isWalletSettling: boolean;
  refetchBootstrap: () => void;
  session: Session | null;
};

export function useWalletAccessState(input: WalletAccessStateInput) {
  const hasCompletionHint = hasCompletedOnboardingForWallet(input.accountAddress);

  return resolveWalletAccessState({
    accountSelected: Boolean(input.accountAddress),
    authError: input.authError,
    bootstrap: input.bootstrap,
    bootstrapError: input.bootstrapError,
    hasCompletionHint,
    hasMatchingWalletSession: input.hasMatchingWalletSession,
    isBootstrapLoading: input.isBootstrapLoading,
    isSigning: input.isSigning,
    isWalletSessionRestorePending: input.isWalletSessionRestorePending,
    isWalletSettling: input.isWalletSettling,
    retry: input.refetchBootstrap,
    session: input.session,
  });
}
