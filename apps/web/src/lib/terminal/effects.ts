import { clearSession } from "@/lib/session";
import { ONBOARDING_COMPLETION_STORAGE_KEY } from "@/lib/onboarding/completion";
import type { TerminalCommandEffect } from "@/types/terminal.types";

export function applyTerminalEffects(effects: TerminalCommandEffect[] = []) {
  if (!effects.includes("clearSessionAndReload")) {
    return;
  }

  clearSession();
  localStorage.removeItem(ONBOARDING_COMPLETION_STORAGE_KEY);
  window.location.reload();
}
