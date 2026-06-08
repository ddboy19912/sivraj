import { useLayoutEffect } from "react";
import { errorMessage, isAuthError } from "@/lib/api";
import { markOnboardingCompleted } from "@/lib/onboarding/completion";
import { isCompletedBootstrap } from "@/hooks/wallet/wallet-access-resolve";
import type { TwinBootstrap } from "@/types/wallet.types";
import type { Session } from "@/lib/session";

export function useTwinBootstrapEffects({
  session,
  bootstrap,
  bootstrapError,
  resetSession,
  setAuthError,
}: {
  session: Session | null;
  bootstrap: TwinBootstrap | null | undefined;
  bootstrapError: unknown;
  resetSession: () => void;
  setAuthError: (error: string | null) => void;
}) {
  useLayoutEffect(() => {
    if (!bootstrapError || !isAuthError(bootstrapError)) {
      return;
    }

    resetSession();
    setAuthError(errorMessage(bootstrapError));
  }, [bootstrapError, resetSession, setAuthError]);

  useLayoutEffect(() => {
    if (!session || !bootstrap) {
      return;
    }

    if (isCompletedBootstrap(bootstrap)) {
      markOnboardingCompleted(session);
    }
  }, [bootstrap, session]);
}
