import { useLayoutEffect, useRef, useState } from "react";

export function usePortaledWalletRect(enabled: boolean) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);

  useLayoutEffect(() => {
    if (!enabled) {
      return;
    }

    const anchor = anchorRef.current;
    if (!anchor) {
      return;
    }

    const syncRect = () => {
      setRect(anchor.getBoundingClientRect());
    };

    const resizeObserver = new ResizeObserver(syncRect);
    resizeObserver.observe(anchor);

    window.addEventListener("resize", syncRect);
    window.addEventListener("scroll", syncRect, true);

    let frame = 0;
    const startedAt = performance.now();
    const trackDuringDrawerMotion = (now: number) => {
      syncRect();
      if (now - startedAt < 450) {
        frame = requestAnimationFrame(trackDuringDrawerMotion);
      }
    };
    frame = requestAnimationFrame(trackDuringDrawerMotion);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", syncRect);
      window.removeEventListener("scroll", syncRect, true);
      cancelAnimationFrame(frame);
    };
  }, [enabled]);

  return { anchorRef, rect: enabled ? rect : null };
}
