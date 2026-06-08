import { createPortal } from "react-dom";
import { usePortaledWalletRect } from "@/components/settings/use-portaled-wallet-rect";
import { NativeWalletConnectButton } from "@/pages/onboarding/NativeWalletConnectButton";

/**
 * Vaul drawers use transforms + Radix focus trapping, which breaks dApp Kit's
 * shadow-DOM connect modal and account popover. Portal the same ConnectButton
 * used in onboarding so it renders in document.body while staying visually aligned.
 */
export function PortaledWalletConnect() {
  const { anchorRef, rect } = usePortaledWalletRect(true);

  return (
    <>
      <div ref={anchorRef} className="min-h-12 w-full" aria-hidden />
      {rect
        ? createPortal(
            <div
              className="pointer-events-auto"
              style={{
                position: "fixed",
                left: rect.left,
                top: rect.top,
                width: rect.width,
                zIndex: 100,
              }}
            >
              <NativeWalletConnectButton />
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
