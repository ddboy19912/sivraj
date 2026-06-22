import type { Session } from "@/lib/session";
import type {
  TwinIdentityProfile,
  TwinProfile,
  VoicePresetResponse,
} from "@/types/onboarding.types";

export type TwinBootstrap = {
  profile: TwinProfile;
  identity: TwinIdentityProfile;
  voiceResponse: VoicePresetResponse | null;
};

export type AppAccessState =
  | { status: "pending"; title: string; message?: string }
  | {
      status: "wallet_auth";
      hasWallet: boolean;
      error: string | null;
      hasCompletionHint: boolean;
    }
  | {
      status: "signing";
      hasWallet: boolean;
      error: string | null;
      hasCompletionHint: boolean;
    }
  | { status: "onboarding"; bootstrap: TwinBootstrap }
  | { status: "app_ready"; bootstrap: TwinBootstrap }
  | {
      status: "fatal_error";
      title: string;
      message: string;
      retry: () => void;
    };

export type ResolveWalletAccessStateInput = {
  accountSelected: boolean;
  authError: string | null;
  bootstrap: TwinBootstrap | null;
  bootstrapError: unknown;
  hasCompletionHint: boolean;
  hasMatchingWalletSession: boolean;
  isBootstrapLoading: boolean;
  isSigning: boolean;
  isWalletSessionRestorePending: boolean;
  isWalletSettling: boolean;
  retry: () => void;
  session: Session | null;
};

export type ResolveActiveSessionInput = {
  selectedWalletAddress: string | null;
  activeSession: Session | null;
  storedSession: Session | null;
  isWalletSettling: boolean;
};

export type ActiveSessionResolution =
  | { status: "unchanged" }
  | { status: "clear_active" }
  | { status: "restore_stored"; session: Session };

export type WalletSessionRestoreStatus =
  | "idle"
  | "pending"
  | "resolved"
  | "timed_out";
