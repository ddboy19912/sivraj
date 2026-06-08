import { useDAppKit } from "@mysten/dapp-kit-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, type RefObject } from "react";
import { errorMessage, postJson } from "@/lib/api";
import { addressesMatch, toSession } from "@/lib/onboarding/session";
import type { Session } from "@/lib/session";
import type { ChallengeResponse, VerifyResponse } from "@/types/onboarding.types";

type UseWalletSignInInput = {
  accountAddressRef: RefObject<string | null>;
  setSession: (session: Session) => void;
  setAuthError: (error: string | null) => void;
};

export function useWalletSignIn({
  accountAddressRef,
  setSession,
  setAuthError,
}: UseWalletSignInInput) {
  const dAppKit = useDAppKit();
  const queryClient = useQueryClient();
  const signInWalletRef = useRef<string | null>(null);

  const signInMutation = useMutation({
    mutationFn: async (accountAddress: string) => {
      return verifyWalletSession({
        accountAddress,
        accountAddressRef,
        dAppKit,
        signInWalletRef,
      });
    },
    onMutate: () => {
      setAuthError(null);
    },
    onSuccess: (nextSession) => {
      if (!nextSession) {
        return;
      }

      setSession(nextSession);
      void queryClient.invalidateQueries({ queryKey: ["twin-bootstrap"] });
    },
    onError: (error) => {
      setAuthError(errorMessage(error));
    },
  });

  function signIn(accountAddress: string | undefined) {
    if (!accountAddress || signInMutation.isPending) {
      return;
    }

    signInMutation.mutate(accountAddress);
  }

  return {
    isSigning: signInMutation.isPending,
    signIn,
  };
}

async function verifyWalletSession({
  accountAddress,
  accountAddressRef,
  dAppKit,
  signInWalletRef,
}: {
  accountAddress: string;
  accountAddressRef: RefObject<string | null>;
  dAppKit: ReturnType<typeof useDAppKit>;
  signInWalletRef: RefObject<string | null>;
}): Promise<Session | null> {
  if (signInWalletRef.current === accountAddress) {
    throw new Error("Wallet verification is already in progress.");
  }

  signInWalletRef.current = accountAddress;

  try {
    if (!addressesMatch(accountAddressRef.current, accountAddress)) {
      return null;
    }

    const challenge = await postJson<ChallengeResponse>("/v1/auth/challenge", {
      walletAddress: accountAddress,
    });

    const signed = addressesMatch(accountAddressRef.current, accountAddress)
      ? await dAppKit.signPersonalMessage({
          message: new TextEncoder().encode(challenge.message),
        })
      : null;

    const verified =
      signed && addressesMatch(accountAddressRef.current, accountAddress)
        ? await postJson<VerifyResponse>("/v1/auth/verify", {
            walletAddress: accountAddress,
            message: challenge.message,
            signature: signed.signature,
            challengeToken: challenge.challengeToken,
          })
        : null;

    const nextSession = verified ? toSession(verified) : null;

    return nextSession &&
      addressesMatch(accountAddressRef.current, nextSession.walletAddress)
      ? nextSession
      : null;
  } finally {
    if (signInWalletRef.current === accountAddress) {
      signInWalletRef.current = null;
    }
  }
}
