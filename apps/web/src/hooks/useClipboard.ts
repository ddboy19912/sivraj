import { useEffect, useRef, useState } from "react";

export type ClipboardStatus = "idle" | "copied" | "pasted" | "failed" | "unsupported";

export function useClipboard(options: { resetMs?: number } = {}) {
  const resetMs = options.resetMs ?? 1400;
  const [status, setStatus] = useState<ClipboardStatus>("idle");
  const resetTimerRef = useRef<number | null>(null);

  function scheduleReset() {
    if (resetTimerRef.current !== null) {
      window.clearTimeout(resetTimerRef.current);
    }

    resetTimerRef.current = window.setTimeout(() => {
      setStatus("idle");
      resetTimerRef.current = null;
    }, resetMs);
  }

  function showStatus(nextStatus: ClipboardStatus) {
    setStatus(nextStatus);
    scheduleReset();
  }

  async function copy(value: string) {
    if (!navigator.clipboard?.writeText) {
      showStatus("unsupported");
      return false;
    }

    try {
      await navigator.clipboard.writeText(value);
      showStatus("copied");
      return true;
    } catch {
      showStatus("failed");
      return false;
    }
  }

  async function read() {
    if (!navigator.clipboard?.readText) {
      showStatus("unsupported");
      return null;
    }

    try {
      return await navigator.clipboard.readText();
    } catch {
      showStatus("failed");
      return null;
    }
  }

  function reset() {
    if (resetTimerRef.current !== null) {
      window.clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }

    setStatus("idle");
  }

  useEffect(() => () => {
    if (resetTimerRef.current !== null) {
      window.clearTimeout(resetTimerRef.current);
    }
  }, []);

  return {
    copy,
    read,
    reset,
    showStatus,
    status,
  };
}
