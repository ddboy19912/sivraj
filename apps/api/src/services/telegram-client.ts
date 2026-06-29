export type TelegramClient = {
  sendMessage(input: {
    chatId: string;
    text: string;
    replyToMessageId?: string | null;
  }): Promise<void>;
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
  };
}
