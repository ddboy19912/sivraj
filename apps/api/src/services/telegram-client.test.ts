import { describe, expect, it } from "vitest";
import { createTelegramClient } from "./telegram-client.js";

describe("createTelegramClient", () => {
  it("loads Telegram file metadata through getFile", async () => {
    const requests: Array<{ url: string; body: unknown }> = [];
    const client = createTelegramClient({
      botToken: "bot-token",
      fetchImpl: (async (url, init) => {
        requests.push({
          url: String(url),
          body: init?.body ? JSON.parse(String(init.body)) as unknown : null,
        });

        return Response.json({
          ok: true,
          result: {
            file_id: "file-id",
            file_unique_id: "unique-id",
            file_size: 123,
            file_path: "documents/file.pdf",
          },
        });
      }) as typeof fetch,
    });

    await expect(client.getFile("file-id")).resolves.toEqual({
      fileId: "file-id",
      fileUniqueId: "unique-id",
      fileSize: 123,
      filePath: "documents/file.pdf",
    });
    expect(requests).toEqual([{
      url: "https://api.telegram.org/botbot-token/getFile",
      body: { file_id: "file-id" },
    }]);
  });

  it("downloads Telegram files through the file API", async () => {
    const urls: string[] = [];
    const client = createTelegramClient({
      botToken: "bot-token",
      fetchImpl: (async (url) => {
        urls.push(String(url));
        return new Response("pdf bytes");
      }) as typeof fetch,
    });

    const bytes = await client.downloadFile("documents/my file.pdf");

    expect(new TextDecoder().decode(bytes)).toBe("pdf bytes");
    expect(urls).toEqual([
      "https://api.telegram.org/file/botbot-token/documents/my%20file.pdf",
    ]);
  });
});
