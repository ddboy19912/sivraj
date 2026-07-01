import type {
  TelegramAccountCommand,
  TelegramInboundEvent,
  TelegramMemoryCorrectionCommand,
  TelegramMessageKind,
  TelegramNormalizedUpdate,
  TelegramUserProfile,
} from "../../types/telegram.types.js";
import {
  readTelegramRememberCommandText,
  routeTelegramPlainText,
} from "./text-intent.js";

export function normalizeTelegramUpdate(update: unknown): TelegramNormalizedUpdate {
  const record = readRecord(update);
  const updateId = valueToString(record["update_id"]);
  const message = readRecord(record["message"]);

  if (!updateId || Object.keys(message).length === 0) {
    return { ok: false, reason: updateId ? "unsupported_update" : "invalid_update" };
  }

  const from = readTelegramUser(message["from"]);
  const chatId = valueToString(readRecord(message["chat"])["id"]);
  const messageId = valueToString(message["message_id"]);

  if (!from || !chatId || !messageId) {
    return { ok: false, reason: "invalid_update" };
  }

  const sentAt = telegramDateToIso(message["date"]);
  const base = {
    updateId,
    telegramUser: from,
    chatId,
    messageId,
    ...(sentAt ? { sentAt } : {}),
  };

  const text = readNonEmptyString(message["text"]);
  const linkToken = text ? readStartCommandToken(text) : null;
  const askQuestion = text ? readAskCommandQuestion(text) : null;
  const capsuleTopic = text ? readCapsuleCommandTopic(text) : null;
  const memoryCorrectionCommand = text ? readTelegramMemoryCorrectionCommand(text) : null;
  const rememberCommand = text ? readTelegramRememberCommandText(text) : null;
  const accountCommand = text ? readTelegramAccountCommand(text) : null;

  if (linkToken && sentAt) {
    return {
      ok: true,
      event: {
        ...base,
        kind: "link_command",
        token: linkToken,
        sentAt,
      },
    };
  }

  if (askQuestion && sentAt) {
    return {
      ok: true,
      event: {
        ...base,
        kind: "ask_command",
        question: askQuestion.question,
        sentAt,
      },
    };
  }

  if (capsuleTopic && sentAt) {
    return {
      ok: true,
      event: {
        ...base,
        kind: "capsule_command",
        topic: capsuleTopic.topic,
        sentAt,
      },
    };
  }

  if (memoryCorrectionCommand && sentAt) {
    return {
      ok: true,
      event: {
        ...base,
        kind: "memory_correction_command",
        command: memoryCorrectionCommand.command,
        query: memoryCorrectionCommand.query,
        replacement: memoryCorrectionCommand.replacement,
        sentAt,
      },
    };
  }

  if (rememberCommand?.text && sentAt) {
    return {
      ok: true,
      event: {
        ...base,
        kind: "capture_text",
        text: rememberCommand.text,
        sentAt,
        forwardOrigin: readForwardOrigin(message),
      },
    };
  }

  if (accountCommand && sentAt) {
    return {
      ok: true,
      event: {
        ...base,
        kind: "account_command",
        command: accountCommand.command,
        sentAt,
      },
    };
  }

  if (text && sentAt && !isTelegramCommand(text)) {
    if (containsTelegramUrl(text)) {
      return {
        ok: true,
        event: {
          ...base,
          kind: "capture_text",
          text,
          sentAt,
          forwardOrigin: readForwardOrigin(message),
        },
      };
    }

    const route = routeTelegramPlainText(text);

    if (route.kind === "ask") {
      return {
        ok: true,
        event: {
          ...base,
          kind: "ask_command",
          question: route.question,
          sentAt,
        },
      };
    }

    return {
      ok: true,
      event: {
        ...base,
        kind: "capture_text",
        text,
        sentAt,
        forwardOrigin: readForwardOrigin(message),
      },
    };
  }

  const media = readTelegramMedia(message);

  if (media && sentAt) {
    return {
      ok: true,
      event: {
        ...base,
        kind: "capture_media",
        ...media,
        caption: readNonEmptyString(message["caption"]),
        sentAt,
        forwardOrigin: readForwardOrigin(message),
      },
    };
  }

  return {
    ok: true,
    event: {
      ...base,
      kind: "unsupported",
    },
  };
}

export function readTelegramMessageKind(event: TelegramInboundEvent): TelegramMessageKind {
  if (event.kind === "ask_command") {
    return "ask";
  }

  if (event.kind === "capsule_command") {
    return "capsule";
  }

  if (event.kind === "memory_correction_command") {
    return "correction";
  }

  if (event.kind === "capture_text") {
    return "text";
  }

  if (event.kind === "capture_media") {
    return event.mediaKind;
  }

  return "unsupported";
}

function readTelegramUser(value: unknown): TelegramUserProfile | null {
  const user = readRecord(value);
  const id = valueToString(user["id"]);

  if (!id) {
    return null;
  }

  const username = readNonEmptyString(user["username"]);
  const firstName = readNonEmptyString(user["first_name"]);
  const lastName = readNonEmptyString(user["last_name"]);
  const displayName = [firstName, lastName].filter(Boolean).join(" ").trim() ||
    (username ? `@${username}` : `Telegram user ${id}`);

  return {
    id,
    username,
    firstName,
    lastName,
    displayName,
  };
}

function readTelegramMedia(message: Record<string, unknown>) {
  const voice = readRecord(message["voice"]);
  const voiceFileId = readNonEmptyString(voice["file_id"]);

  if (voiceFileId) {
    return {
      mediaKind: "voice" as const,
      fileId: voiceFileId,
      fileUniqueId: readNonEmptyString(voice["file_unique_id"]),
      fileSize: readNumberOrNull(voice["file_size"]),
      mimeType: readNonEmptyString(voice["mime_type"]),
    };
  }

  const document = readRecord(message["document"]);
  const documentFileId = readNonEmptyString(document["file_id"]);

  if (documentFileId) {
    return {
      mediaKind: "document" as const,
      fileId: documentFileId,
      fileUniqueId: readNonEmptyString(document["file_unique_id"]),
      fileSize: readNumberOrNull(document["file_size"]),
      fileName: readNonEmptyString(document["file_name"]),
      mimeType: readNonEmptyString(document["mime_type"]),
    };
  }

  const photos = Array.isArray(message["photo"])
    ? message["photo"].map(readRecord)
    : [];
  const bestPhoto = photos
    .filter((photo) => readNonEmptyString(photo["file_id"]))
    .sort((a, b) => readNumber(b["file_size"]) - readNumber(a["file_size"]))[0];
  const photoFileId = bestPhoto ? readNonEmptyString(bestPhoto["file_id"]) : null;

  if (photoFileId) {
    return {
      mediaKind: "photo" as const,
      fileId: photoFileId,
      fileUniqueId: readNonEmptyString(bestPhoto["file_unique_id"]),
      fileSize: readNumberOrNull(bestPhoto["file_size"]),
    };
  }

  return null;
}

function readForwardOrigin(message: Record<string, unknown>) {
  const origin = readRecord(message["forward_origin"]);

  if (Object.keys(origin).length === 0) {
    return null;
  }

  return {
    type: readNonEmptyString(origin["type"]),
    senderUserId: valueToString(readRecord(origin["sender_user"])["id"]),
    senderUserName: readNonEmptyString(readRecord(origin["sender_user"])["username"]),
    senderUserFirstName: readNonEmptyString(readRecord(origin["sender_user"])["first_name"]),
    senderChatId: valueToString(readRecord(origin["sender_chat"])["id"]),
    senderChatTitle: readNonEmptyString(readRecord(origin["sender_chat"])["title"]),
    date: telegramDateToIso(origin["date"]),
  };
}

function readStartCommandToken(text: string): string | null {
  const match = /^\/start(?:@\w+)?\s+([A-Za-z0-9_-]{16,256})$/u.exec(text.trim());
  return match?.[1] ?? null;
}

function readAskCommandQuestion(text: string): { question: string | null } | null {
  const match = /^\/ask(?:@\w+)?(?:\s+([\s\S]*))?$/u.exec(text.trim());
  if (!match) {
    return null;
  }

  return { question: readNonEmptyString(match[1]) };
}

function readCapsuleCommandTopic(text: string): { topic: string | null } | null {
  const match = /^\/capsule(?:@\w+)?(?:\s+([\s\S]*))?$/u.exec(text.trim());
  if (!match) {
    return null;
  }

  return { topic: readNonEmptyString(match[1]) };
}

function readTelegramMemoryCorrectionCommand(text: string): {
  command: TelegramMemoryCorrectionCommand;
  query: string | null;
  replacement: string | null;
} | null {
  const match = /^\/(forget|correct|stale)(?:@\w+)?(?:\s+([\s\S]*))?$/u.exec(text.trim().toLowerCase());
  if (!match) {
    return null;
  }

  const command = match[1] as TelegramMemoryCorrectionCommand;
  const originalBodyMatch = /^\/(?:forget|correct|stale)(?:@\w+)?(?:\s+([\s\S]*))?$/iu.exec(text.trim());
  const body = readNonEmptyString(originalBodyMatch?.[1]);

  if (command !== "correct") {
    return {
      command,
      query: body,
      replacement: null,
    };
  }

  const correction = splitTelegramCorrectionBody(body);
  return {
    command,
    query: correction.query,
    replacement: correction.replacement,
  };
}

function splitTelegramCorrectionBody(body: string | null): {
  query: string | null;
  replacement: string | null;
} {
  if (!body) {
    return { query: null, replacement: null };
  }

  const match = /^([\s\S]+?)\s*(?:->|=>)\s*([\s\S]+)$/u.exec(body.trim());
  if (!match) {
    return { query: body, replacement: null };
  }

  return {
    query: readNonEmptyString(match[1]),
    replacement: readNonEmptyString(match[2]),
  };
}

function readTelegramAccountCommand(text: string): { command: TelegramAccountCommand } | null {
  const match = /^\/(help|status|whoami|unlink|switch|start)(?:@\w+)?\s*$/u.exec(text.trim().toLowerCase());
  const command = match?.[1];

  if (!command) {
    return null;
  }

  return { command: (command === "start" ? "help" : command) as TelegramAccountCommand };
}

function isTelegramCommand(text: string) {
  return text.trim().startsWith("/");
}

function containsTelegramUrl(text: string) {
  return /https?:\/\/[^\s<>"')\]]+/iu.test(text);
}

function telegramDateToIso(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return new Date(value * 1000).toISOString();
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function valueToString(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return readNonEmptyString(value);
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function readNumberOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
