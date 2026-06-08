import type { Session } from "@/lib/session";
import { addressesMatch } from "@/lib/onboarding/session";

export const ONBOARDING_COMPLETION_STORAGE_KEY =
  "sivraj.onboarding.completed.v1";

type CompletionMap = Record<string, true>;

export function hasCompletedOnboarding(session: Session | null): boolean {
  return Boolean(session && readCompletionMap()[completionKey(session)]);
}

export function hasCompletedOnboardingForWallet(walletAddress: string | null | undefined): boolean {
  if (!walletAddress) {
    return false;
  }

  return Object.keys(readCompletionMap()).some((key) => {
    const [completedWalletAddress] = key.split(":");
    return addressesMatch(completedWalletAddress, walletAddress);
  });
}

export function markOnboardingCompleted(session: Session) {
  const completionMap = readCompletionMap();
  completionMap[completionKey(session)] = true;
  localStorage.setItem(
    ONBOARDING_COMPLETION_STORAGE_KEY,
    JSON.stringify(completionMap),
  );
}

function completionKey(session: Session) {
  return `${session.walletAddress}:${session.twinId}`;
}

function readCompletionMap(): CompletionMap {
  const raw = localStorage.getItem(ONBOARDING_COMPLETION_STORAGE_KEY);

  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).filter(([, value]) => value === true),
    ) as CompletionMap;
  } catch {
    return {};
  }
}
