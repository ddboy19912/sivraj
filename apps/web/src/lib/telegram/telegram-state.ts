import type {
  TelegramConnectionResponse,
  TelegramConnectionStatus,
} from "@/types/telegram.types";

export type TelegramStatusPresentation = {
  label: string;
  tone: "idle" | "active" | "pending" | "warning" | "error";
  detail: string;
};

const TELEGRAM_DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export function resolveTelegramStatusPresentation(
  status: TelegramConnectionStatus,
): TelegramStatusPresentation {
  switch (status) {
    case "linked":
      return {
        label: "Linked",
        tone: "active",
        detail: "Telegram captures are routed into your Twin.",
      };
    case "pending_link":
      return {
        label: "Pending",
        tone: "pending",
        detail: "Waiting for Telegram confirmation.",
      };
    case "revoked":
      return {
        label: "Revoked",
        tone: "warning",
        detail: "Telegram access was revoked. Create a fresh link to reconnect.",
      };
    case "error":
      return {
        label: "Error",
        tone: "error",
        detail: "Telegram needs attention before it can capture memory.",
      };
    case "unlinked":
      return {
        label: "Unlinked",
        tone: "idle",
        detail: "Connect Telegram to capture messages.",
      };
  }
}

export function resolveTelegramConnectionSubtitle(
  connection: TelegramConnectionResponse | null,
  presentation: TelegramStatusPresentation,
) {
  if (!connection || connection.status !== "linked") {
    return presentation.detail;
  }

  return connection.account?.displayName ?? presentation.detail;
}

export function telegramStatusDotClass(tone: TelegramStatusPresentation["tone"]) {
  switch (tone) {
    case "active":
      return "bg-emerald-300 shadow-[0_0_14px_rgba(110,231,183,0.36)]";
    case "pending":
      return "bg-amber-300 shadow-[0_0_14px_rgba(252,211,77,0.32)]";
    case "warning":
      return "bg-orange-300 shadow-[0_0_14px_rgba(253,186,116,0.28)]";
    case "error":
      return "bg-rose-300 shadow-[0_0_14px_rgba(253,164,175,0.32)]";
    case "idle":
      return "bg-white/34";
  }
}

export function formatTelegramDate(value: string | null | undefined) {
  if (!value) {
    return "No date";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Unknown date";
  }

  return TELEGRAM_DATE_FORMATTER.format(date);
}
