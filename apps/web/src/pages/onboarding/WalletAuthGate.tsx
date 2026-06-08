import { Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { liquidGlass } from "@/lib/ui/liquid-glass";
import { cn } from "@/lib/ui/utils";
import type { OnboardingFlow } from "@/types/onboarding.types";
import { NativeWalletConnectButton } from "@/pages/onboarding/NativeWalletConnectButton";

type WalletAuthGateProps = {
  flow: OnboardingFlow;
};

export function WalletAuthGate({ flow }: WalletAuthGateProps) {
  if (
    flow.accessState.status !== "wallet_auth" &&
    flow.accessState.status !== "signing"
  ) {
    return null;
  }

  const hasWallet = flow.accessState.hasWallet;
  const isSigning = flow.accessState.status === "signing";
  const error = flow.accessState.error ?? flow.error;

  return (
    <section
      className={cn(
        liquidGlass,
        "absolute inset-x-4 top-[8svh] z-20 mx-auto w-[min(560px,calc(100vw-32px))] rounded-[28px] p-5 text-left max-[760px]:top-[7svh]",
      )}
      aria-label="Wallet authentication"
    >
      <div className="grid gap-5">
        <div className="grid gap-2">
          <p className="font-mono text-xs font-bold uppercase tracking-[1.6px] text-[rgb(var(--theme-color-rgb))]">
            Wallet
          </p>
          <h2 className="text-2xl font-semibold tracking-normal text-white">
            {hasWallet ? "Verify this wallet" : "Connect a wallet"}
          </h2>
        </div>

        <div className="grid grid-cols-2 items-stretch gap-3 max-[560px]:grid-cols-1">
          <NativeWalletConnectButton />
          <Button
            variant="primary"
            type="button"
            onClick={flow.signIn}
            disabled={!hasWallet || isSigning}
          >
            {isSigning ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <ShieldCheck className="size-4" />
            )}
            {isSigning ? "Verifying..." : "Verify wallet"}
          </Button>
        </div>

        {error ? (
          <p className="rounded-2xl border border-red-300/20 bg-red-500/10 px-4 py-3 text-sm text-red-100">
            {error}
          </p>
        ) : null}
      </div>
    </section>
  );
}
