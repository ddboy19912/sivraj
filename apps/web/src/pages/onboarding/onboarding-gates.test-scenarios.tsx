import { expect } from "vitest";

import { render, screen } from "@testing-library/react";
import { OnboardingPanel } from "@/pages/onboarding/OnboardingPanel";
import { WalletAuthGate } from "@/pages/onboarding/WalletAuthGate";
import { createBootstrap, createFlow, walletAccount } from "@/tests/fixtures/onboarding-fixtures";

export async function run_shows_wallet_auth_gate_without_showing_onboarding_for_unveri() {
  const flow = createFlow({
      accessState: {
        status: "wallet_auth",
        hasWallet: true,
        error: null,
        hasCompletionHint: false,
      },
      currentStep: null,
      account: walletAccount("0x123"),
    });

    render(
      <>
        <WalletAuthGate flow={flow} />
        <OnboardingPanel flow={flow} />
      </>,
    );

    expect(screen.getByLabelText("Wallet authentication")).toBeInTheDocument();
    expect(screen.queryByLabelText("Twin onboarding")).not.toBeInTheDocument();
}

export async function run_shows_onboarding_only_after_wallet_verification_resolves_to_() {
  const flow = createFlow({
      accessState: {
        status: "onboarding",
        bootstrap: createBootstrap("not_started"),
      },
      currentStep: "name",
      account: walletAccount("0x123"),
    });

    render(
      <>
        <WalletAuthGate flow={flow} />
        <OnboardingPanel flow={flow} />
      </>,
    );

    expect(screen.queryByLabelText("Wallet authentication")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Twin onboarding")).toBeInTheDocument();
}

export async function run_shows_neither_wallet_auth_nor_onboarding_for_completed_users() {
  const flow = createFlow({
      accessState: {
        status: "app_ready",
        bootstrap: createBootstrap("completed"),
      },
      currentStep: null,
      account: walletAccount("0x123"),
    });

    render(
      <>
        <WalletAuthGate flow={flow} />
        <OnboardingPanel flow={flow} />
      </>,
    );

    expect(screen.queryByLabelText("Wallet authentication")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Twin onboarding")).not.toBeInTheDocument();
}
