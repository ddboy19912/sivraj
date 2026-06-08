import { Check, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { OnboardingStepViewProps } from "@/types/onboarding.types";
import { NativeWalletConnectButton } from "@/pages/onboarding/NativeWalletConnectButton";
import { StepHeading } from "@/pages/onboarding/ui/StepHeading";

export function ConnectStep({ flow }: OnboardingStepViewProps) {
  const isVerified = flow.isSessionForWallet;

  return (
    <div className="grid gap-5">
      <StepHeading
        eyebrow="Ownership"
        title="First, prove where this Twin belongs."
        body="Connect and verify your Sui wallet before anything personal is created."
      />
      <div className="grid grid-cols-2 items-stretch gap-3">
        <NativeWalletConnectButton />
        <Button
          variant="primary"
          type="button"
          onClick={flow.signIn}
          disabled={!flow.account || flow.isBusy || isVerified}
        >
          {isVerified ? (
            <>
              <Check className="size-4" />
              Wallet verified
            </>
          ) : (
            <>
              {flow.isBusy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <ShieldCheck className="size-4" />
              )}
              {flow.isBusy ? "Verifying..." : "Verify wallet"}
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
