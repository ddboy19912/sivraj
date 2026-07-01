export type TelegramClient = {
  sendMessage(input: {
    chatId: string;
    text: string;
    replyToMessageId?: string | null;
  }): Promise<void>;
  getFile(fileId: string): Promise<TelegramFile>;
  downloadFile(filePath: string): Promise<ArrayBuffer>;
};

export type TelegramFile = {
  fileId: string;
  fileUniqueId: string | null;
  fileSize: number | null;
  filePath: string | null;
};

export function createConfiguredTelegramClient(
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch = fetch,
): TelegramClient | null {
  const botToken = env["TELEGRAM_BOT_TOKEN"]?.trim();

  if (!botToken) {
    return null;
  }

  return createTelegramClient({ botToken, fetchImpl });
}

export function createTelegramClient({
  botToken,
  fetchImpl = fetch,
}: {
  botToken: string;
  fetchImpl?: typeof fetch;
}): TelegramClient {
  const apiBaseUrl = `https://api.telegram.org/bot${botToken}`;
  const fileBaseUrl = `https://api.telegram.org/file/bot${botToken}`;

  return {
    async sendMessage(input) {
      const response = await fetchImpl(`${apiBaseUrl}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: input.chatId,
          text: input.text,
          ...(input.replyToMessageId
            ? { reply_parameters: { message_id: Number(input.replyToMessageId) } }
            : {}),
        }),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(`telegram_send_message_failed:${response.status}:${body.slice(0, 120)}`);
      }
    },
    async getFile(fileId) {
      const response = await fetchImpl(`${apiBaseUrl}/getFile`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ file_id: fileId }),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(`telegram_get_file_failed:${response.status}:${body.slice(0, 120)}`);
      }

      const body = await response.json().catch(() => null) as unknown;
      const file = readTelegramFileResponse(body);

      if (!file) {
        throw new Error("telegram_get_file_invalid_response");
      }

      return file;
    },
    async downloadFile(filePath) {
      const normalizedPath = normalizeTelegramFilePath(filePath);

      if (!normalizedPath) {
        throw new Error("telegram_download_file_invalid_path");
      }

      const response = await fetchImpl(`${fileBaseUrl}/${normalizedPath}`);

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(`telegram_download_file_failed:${response.status}:${body.slice(0, 120)}`);
      }

      return response.arrayBuffer();
    },
  };
}

function readTelegramFileResponse(value: unknown): TelegramFile | null {
  const record = readRecord(value);

  if (record["ok"] !== true) {
    return null;
  }

  const result = readRecord(record["result"]);
  const fileId = readString(result["file_id"]);

  if (!fileId) {
    return null;
  }

  return {
    fileId,
    fileUniqueId: readString(result["file_unique_id"]),
    fileSize: readNumber(result["file_size"]),
    filePath: readString(result["file_path"]),
  };
}

function normalizeTelegramFilePath(value: string): string | null {
  const trimmed = value.trim().replace(/^\/+/u, "");

  if (!trimmed || trimmed.includes("..")) {
    return null;
  }

  return trimmed
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
