import type {
  ActiveSessionResolution,
  AppAccessState,
  ResolveActiveSessionInput,
  ResolveWalletAccessStateInput,
  TwinBootstrap,
} from "@/types/wallet.types";
import { errorMessage, isAuthError } from "@/lib/api";
import { normalizeTwinName } from "@/lib/onboarding/flow-selectors";
import { addressesMatch } from "@/lib/onboarding/session";

export function resolveWalletAccessState(
  input: ResolveWalletAccessStateInput,
): AppAccessState {
  const pending = resolveWalletPendingState(input);
  if (pending) {
    return pending;
  }

  const signing = resolveWalletSigningState(input);
  if (signing) {
    return signing;
  }

  const auth = resolveWalletAuthGate(input);
  if (auth) {
    return auth;
  }

  const bootstrap = resolveBootstrapAccessState(input);
  if (bootstrap) {
    return bootstrap;
  }

  return {
    status: "pending",
    title: "Initializing Twin",
    message: "Waiting for Twin profile.",
  };
}

function resolveWalletPendingState({
  isWalletSettling,
}: ResolveWalletAccessStateInput): AppAccessState | null {
  if (!isWalletSettling) {
    return null;
  }

  return {
    status: "pending",
    title: "Booting up",
    message: "Resolving wallet connection.",
  };
}

function resolveWalletSigningState({
  isSigning,
  accountSelected,
  authError,
  hasCompletionHint,
}: ResolveWalletAccessStateInput): AppAccessState | null {
  if (!isSigning) {
    return null;
  }

  return {
    status: "signing",
    hasWallet: accountSelected,
    error: authError,
    hasCompletionHint,
  };
}

function resolveWalletAuthGate({
  accountSelected,
  session,
  hasMatchingWalletSession,
  authError,
  hasCompletionHint,
}: ResolveWalletAccessStateInput): AppAccessState | null {
  if (accountSelected && session && hasMatchingWalletSession) {
    return null;
  }

  return {
    status: "wallet_auth",
    hasWallet: accountSelected,
    error: authError,
    hasCompletionHint,
  };
}

function resolveBootstrapAccessState(
  input: ResolveWalletAccessStateInput,
): AppAccessState | null {
  const error = resolveBootstrapErrorState(input);
  if (error) {
    return error;
  }

  const ready = resolveBootstrapReadyState(input);
  if (ready) {
    return ready;
  }

  return resolveBootstrapLoadingState(input);
}

function resolveBootstrapLoadingState({
  isBootstrapLoading,
}: ResolveWalletAccessStateInput): AppAccessState | null {
  if (!isBootstrapLoading) {
    return null;
  }

  return {
    status: "pending",
    title: "Initializing Twin",
    message: "Loading your verified Twin profile.",
  };
}

function resolveBootstrapErrorState({
  bootstrap,
  bootstrapError,
  hasCompletionHint,
  retry,
}: ResolveWalletAccessStateInput): AppAccessState | null {
  if (!bootstrapError) {
    return null;
  }

  if (isAuthError(bootstrapError)) {
    return {
      status: "wallet_auth",
      hasWallet: true,
      error: errorMessage(bootstrapError),
      hasCompletionHint,
    };
  }

  if (bootstrap) {
    return null;
  }

  return {
    status: "fatal_error",
    title: "Twin initialization failed",
    message: errorMessage(bootstrapError),
    retry,
  };
}

function resolveBootstrapReadyState({
  bootstrap,
}: ResolveWalletAccessStateInput): AppAccessState | null {
  if (!bootstrap) {
    return null;
  }

  if (isCompletedBootstrap(bootstrap)) {
    return { status: "app_ready", bootstrap };
  }

  return { status: "onboarding", bootstrap };
}

export function resolveActiveSession({
  selectedWalletAddress,
  activeSession,
  storedSession,
  isWalletSettling,
}: ResolveActiveSessionInput): ActiveSessionResolution {
  if (isWalletSettling) {
    return { status: "unchanged" };
  }

  if (!selectedWalletAddress) {
    return activeSession ? { status: "clear_active" } : { status: "unchanged" };
  }

  if (
    activeSession &&
    !addressesMatch(activeSession.walletAddress, selectedWalletAddress)
  ) {
    return { status: "clear_active" };
  }

  if (
    !activeSession &&
    storedSession &&
    addressesMatch(storedSession.walletAddress, selectedWalletAddress)
  ) {
    return { status: "restore_stored", session: storedSession };
  }

  return { status: "unchanged" };
}

export function isCompletedBootstrap({ profile, identity }: TwinBootstrap) {
  return (
    identity.onboardingStatus === "completed" &&
    normalizeTwinName(profile.name).length > 0
  );
}
