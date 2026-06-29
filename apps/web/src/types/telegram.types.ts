export type TelegramConnectionStatus =
  | "unlinked"
  | "pending_link"
  | "linked"
  | "revoked"
  | "error";

export type TelegramAccountSummary = {
  id: string;
  status: string;
  displayName: string;
  externalAccountId: string | null;
  metadata: unknown;
  createdAt: string;
  updatedAt: string;
};

export type TelegramPendingLink = {
  id: string;
  expiresAt: string;
};

export type TelegramCaptureSummary = {
  id: string;
  status: "processing" | "captured" | "deferred" | "failed";
  sourceArtifactId: string | null;
  chatId: string;
  messageId: string;
  createdAt: string;
  metadata: unknown;
};

export type TelegramConnectionResponse = {
  status: TelegramConnectionStatus;
  botUsername: string | null;
  account: TelegramAccountSummary | null;
  pendingLink: TelegramPendingLink | null;
  recentCaptures: TelegramCaptureSummary[];
};

export type TelegramLinkTokenResponse = {
  status: "pending_link";
  token: string;
  tokenId: string;
  expiresAt: string;
  botUsername: string | null;
  deepLink: string | null;
  startCommand?: string;
};

export type TelegramRevokeResponse = {
  status: "revoked" | "unlinked";
};
