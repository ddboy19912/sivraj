import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppGlobalOverlay } from "@/components/app/AppGlobalOverlay";
import type { AppOverlay } from '@/lib/app/overlay'
import type { OnboardingFlow } from "@/types/onboarding.types";
import { createBootstrap, createFlow } from "@/tests/fixtures/onboarding-fixtures";

vi.mock("@/pages/onboarding/NativeWalletConnectButton", () => ({
  NativeWalletConnectButton: () => (
    <button type="button">Connect wallet</button>
  ),
}));

describe("AppGlobalOverlay", () => {
  it("renders a pending overlay during boot", () => {
    renderOverlay(
      "pending",
      createFlow({
        accessState: {
          status: "pending",
          title: "Booting up",
          message: "Resolving wallet connection.",
        },
      }),
    );

    expect(screen.getByLabelText("App loading")).toBeInTheDocument();
    expect(screen.getByText("Booting up")).toBeInTheDocument();
  });

  it("renders wallet auth only for wallet auth overlay state", () => {
    renderOverlay(
      "wallet_auth",
      createFlow({
        accessState: {
          status: "wallet_auth",
          hasWallet: true,
          error: null,
          hasCompletionHint: false,
        },
      }),
    );

    expect(screen.getByLabelText("Wallet authentication")).toBeInTheDocument();
    expect(screen.queryByLabelText("App loading")).not.toBeInTheDocument();
  });

  it("renders onboarding only for onboarding overlay state", () => {
    renderOverlay(
      "onboarding",
      createFlow({
        accessState: {
          status: "onboarding",
          bootstrap: createBootstrap("not_started"),
        },
        currentStep: "name",
      }),
    );

    expect(screen.getByLabelText("Twin onboarding")).toBeInTheDocument();
    expect(screen.queryByLabelText("App loading")).not.toBeInTheDocument();
  });
});

function renderOverlay(overlay: AppOverlay, flow: OnboardingFlow) {
  return render(<AppGlobalOverlay flow={flow} overlay={overlay} />);
}
