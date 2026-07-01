export type TelegramConnectionStatus =
  | "unlinked"
  | "pending_link"
  | "linked"
  | "revoked"
  | "error";

export type TelegramMessageKind =
  | "text"
  | "ask"
  | "capsule"
  | "correction"
  | "photo"
  | "document"
  | "voice"
  | "unsupported";

export type TelegramAccountCommand =
  | "help"
  | "status"
  | "whoami"
  | "unlink"
  | "switch";

export type TelegramMemoryCorrectionCommand =
  | "forget"
  | "correct"
  | "stale";

export type TelegramUserProfile = {
  id: string;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  displayName: string;
};

export type TelegramBaseInboundEvent = {
  updateId: string;
  telegramUser: TelegramUserProfile;
  chatId: string;
  messageId?: string;
  sentAt?: string;
};

export type TelegramInboundEvent =
  | (TelegramBaseInboundEvent & {
      kind: "link_command";
      token: string;
      messageId: string;
      sentAt: string;
    })
  | (TelegramBaseInboundEvent & {
      kind: "capture_text";
      messageId: string;
      text: string;
      sentAt: string;
      forwardOrigin?: Record<string, unknown> | null;
    })
  | (TelegramBaseInboundEvent & {
      kind: "ask_command";
      messageId: string;
      question: string | null;
      sentAt: string;
    })
  | (TelegramBaseInboundEvent & {
      kind: "capsule_command";
      messageId: string;
      topic: string | null;
      sentAt: string;
    })
  | (TelegramBaseInboundEvent & {
      kind: "memory_correction_command";
      command: TelegramMemoryCorrectionCommand;
      messageId: string;
      query: string | null;
      replacement: string | null;
      sentAt: string;
    })
  | (TelegramBaseInboundEvent & {
      kind: "account_command";
      command: TelegramAccountCommand;
      messageId: string;
      sentAt: string;
    })
  | (TelegramBaseInboundEvent & {
      kind: "capture_media";
      messageId: string;
      mediaKind: "photo" | "document" | "voice";
      fileId: string;
      fileUniqueId?: string | null;
      fileSize?: number | null;
      fileName?: string | null;
      mimeType?: string | null;
      caption?: string | null;
      sentAt: string;
      forwardOrigin?: Record<string, unknown> | null;
    })
  | (TelegramBaseInboundEvent & {
      kind: "unsupported";
      messageId?: string;
    });

export type TelegramNormalizedUpdate =
  | { ok: true; event: TelegramInboundEvent }
  | { ok: false; reason: "unsupported_update" | "invalid_update" };
