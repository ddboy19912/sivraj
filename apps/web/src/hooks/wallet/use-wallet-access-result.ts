import type { AppAccessState } from "@/types/wallet.types";
import type { Session } from "@/lib/session";
import type { TwinBootstrap } from "@/types/wallet.types";

type WalletAccessResultInput = {
  account: { address: string } | null | undefined;
  accessState: AppAccessState;
  bootstrap: TwinBootstrap | null;
  hasMatchingWalletSession: boolean;
  session: Session | null;
  setSession: (session: Session) => void;
  resetSession: () => void;
  signIn: () => void;
  updateBootstrap: (
    updater: (current: TwinBootstrap) => TwinBootstrap,
  ) => void;
};

export function buildWalletAccessResult(input: WalletAccessResultInput) {
  return {
    account: input.account,
    accessState: input.accessState,
    bootstrap: input.bootstrap,
    canUseProtectedApp: input.accessState.status === "app_ready",
    hasMatchingWalletSession: input.hasMatchingWalletSession,
    isSessionForWallet:
      input.hasMatchingWalletSession &&
      (input.accessState.status === "app_ready" ||
        input.accessState.status === "onboarding"),
    resetSession: input.resetSession,
    session: input.hasMatchingWalletSession ? input.session : null,
    setSession: input.setSession,
    signIn: input.signIn,
    updateBootstrap: input.updateBootstrap,
  };
}
