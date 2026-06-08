import { ConnectButton } from "@mysten/dapp-kit-react/ui";
import { Wallet } from "lucide-react";
import { useLayoutEffect, useRef } from "react";

const SHADOW_STYLE_ID = "sivraj-connect-layout-overrides";

function syncConnectButtonLayout(wrapper: HTMLDivElement) {
  const connectButton = wrapper.querySelector("mysten-dapp-kit-connect-button");
  const shadow = connectButton?.shadowRoot;
  if (!shadow) {
    return;
  }

  const width = wrapper.clientWidth;
  if (connectButton instanceof HTMLElement && width > 0) {
    connectButton.style.width = `${width}px`;
    connectButton.style.maxWidth = "100%";
  }

  let styleEl = shadow.querySelector<HTMLStyleElement>(`#${SHADOW_STYLE_ID}`);
  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = SHADOW_STYLE_ID;
    shadow.appendChild(styleEl);
  }

  styleEl.textContent = `
    connected-account-menu,
    internal-button {
      display: block !important;
      width: 100% !important;
      max-width: 100% !important;
    }

    connected-account-menu::part(trigger),
    internal-button::part(trigger) {
      display: flex !important;
      width: 100% !important;
      max-width: 100% !important;
      box-sizing: border-box !important;
    }
  `;
}

export function NativeWalletConnectButton() {
  const wrapperRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) {
      return;
    }

    const runSync = () => syncConnectButtonLayout(wrapper);

    runSync();
    const resizeObserver = new ResizeObserver(runSync);
    resizeObserver.observe(wrapper);

    const mutationObserver = new MutationObserver(runSync);
    mutationObserver.observe(wrapper, { childList: true, subtree: true });

    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      const connectButton = wrapper.querySelector(
        "mysten-dapp-kit-connect-button",
      );
      connectButton?.shadowRoot?.querySelector(`#${SHADOW_STYLE_ID}`)?.remove();
    };
  }, []);

  return (
    <div
      ref={wrapperRef}
      className="sivraj-native-wallet-connect w-full min-w-0"
    >
      <ConnectButton>
        <span className="inline-flex w-full items-center justify-center gap-2">
          <Wallet className="size-4 shrink-0 text-[rgb(var(--theme-color-rgb))]" />
          Connect wallet
        </span>
      </ConnectButton>
    </div>
  );
}
