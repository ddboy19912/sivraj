import { describe, expect, it } from "vitest";
import { normalizeTelegramUpdate } from "./updates.js";

describe("Telegram update normalization", () => {
  it("normalizes start commands with link tokens", () => {
    const normalized = normalizeTelegramUpdate({
      update_id: 1001,
      message: {
        message_id: 44,
        date: 1781719200,
        text: "/start abc_1234567890abcdef",
        from: {
          id: 123456,
          username: "ada",
          first_name: "Ada",
          last_name: "Lovelace",
        },
        chat: { id: 123456, type: "private" },
      },
    });

    expect(normalized).toMatchObject({
      ok: true,
      event: {
        kind: "link_command",
        updateId: "1001",
        chatId: "123456",
        messageId: "44",
        token: "abc_1234567890abcdef",
        telegramUser: {
          id: "123456",
          username: "ada",
          displayName: "Ada Lovelace",
        },
      },
    });
  });

  it("normalizes text captures without leaking forward payload text into metadata", () => {
    const normalized = normalizeTelegramUpdate({
      update_id: 1002,
      message: {
        message_id: 45,
        date: 1781719300,
        text: "Remember the Telegram launch starts with private capture.",
        from: { id: 123456, first_name: "Ada" },
        chat: { id: 123456, type: "private" },
        forward_origin: {
          type: "user",
          sender_user: { id: 789, username: "grace", first_name: "Grace" },
          date: 1781719000,
        },
      },
    });

    expect(normalized).toMatchObject({
      ok: true,
      event: {
        kind: "capture_text",
        text: "Remember the Telegram launch starts with private capture.",
        forwardOrigin: {
          type: "user",
          senderUserId: "789",
          senderUserName: "grace",
        },
      },
    });
  });

  it("normalizes ask commands without capturing the question as memory", () => {
    const normalized = normalizeTelegramUpdate({
      update_id: 1004,
      message: {
        message_id: 47,
        date: 1781719500,
        text: "/ask What do I prefer for investor calls?",
        from: { id: 123456, username: "ada" },
        chat: { id: 123456, type: "private" },
      },
    });

    expect(normalized).toMatchObject({
      ok: true,
      event: {
        kind: "ask_command",
        question: "What do I prefer for investor calls?",
      },
    });
  });

  it("normalizes capsule commands without capturing the topic as memory", () => {
    const normalized = normalizeTelegramUpdate({
      update_id: 1014,
      message: {
        message_id: 57,
        date: 1781720500,
        text: "/capsule fundraising strategy",
        from: { id: 123456, username: "ada" },
        chat: { id: 123456, type: "private" },
      },
    });

    expect(normalized).toMatchObject({
      ok: true,
      event: {
        kind: "capsule_command",
        topic: "fundraising strategy",
      },
    });
  });

  it("normalizes memory correction commands without capturing them as memory", () => {
    const normalized = normalizeTelegramUpdate({
      update_id: 1015,
      message: {
        message_id: 58,
        date: 1781720600,
        text: "/correct occupation -> lawyer",
        from: { id: 123456, username: "ada" },
        chat: { id: 123456, type: "private" },
      },
    });

    expect(normalized).toMatchObject({
      ok: true,
      event: {
        kind: "memory_correction_command",
        command: "correct",
        query: "occupation",
        replacement: "lawyer",
      },
    });
  });

  it("normalizes stale and forget commands with phrases", () => {
    expect(normalizeTelegramUpdate({
      update_id: 1016,
      message: {
        message_id: 59,
        date: 1781720700,
        text: "/forget dog name",
        from: { id: 123456, username: "ada" },
        chat: { id: 123456, type: "private" },
      },
    })).toMatchObject({
      ok: true,
      event: {
        kind: "memory_correction_command",
        command: "forget",
        query: "dog name",
        replacement: null,
      },
    });

    expect(normalizeTelegramUpdate({
      update_id: 1017,
      message: {
        message_id: 60,
        date: 1781720800,
        text: "/stale investor calls",
        from: { id: 123456, username: "ada" },
        chat: { id: 123456, type: "private" },
      },
    })).toMatchObject({
      ok: true,
      event: {
        kind: "memory_correction_command",
        command: "stale",
        query: "investor calls",
        replacement: null,
      },
    });
  });

  it("normalizes account commands without capturing them as memory", () => {
    const normalized = normalizeTelegramUpdate({
      update_id: 1009,
      message: {
        message_id: 52,
        date: 1781720000,
        text: "/status",
        from: { id: 123456, username: "ada" },
        chat: { id: 123456, type: "private" },
      },
    });

    expect(normalized).toMatchObject({
      ok: true,
      event: {
        kind: "account_command",
        command: "status",
      },
    });
  });

  it("normalizes bare start commands as help instead of capture", () => {
    const normalized = normalizeTelegramUpdate({
      update_id: 1010,
      message: {
        message_id: 53,
        date: 1781720100,
        text: "/start",
        from: { id: 123456, username: "ada" },
        chat: { id: 123456, type: "private" },
      },
    });

    expect(normalized).toMatchObject({
      ok: true,
      event: {
        kind: "account_command",
        command: "help",
      },
    });
  });

  it("normalizes unlink commands as account commands", () => {
    const normalized = normalizeTelegramUpdate({
      update_id: 1011,
      message: {
        message_id: 54,
        date: 1781720200,
        text: "/unlink",
        from: { id: 123456, username: "ada" },
        chat: { id: 123456, type: "private" },
      },
    });

    expect(normalized).toMatchObject({
      ok: true,
      event: {
        kind: "account_command",
        command: "unlink",
      },
    });
  });

  it("normalizes natural questions without requiring question marks", () => {
    const normalized = normalizeTelegramUpdate({
      update_id: 1006,
      message: {
        message_id: 49,
        date: 1781719700,
        text: "Can you tell me about the Sivraj_Demo_Launch_Notes.pdf file",
        from: { id: 123456, username: "ada" },
        chat: { id: 123456, type: "private" },
      },
    });

    expect(normalized).toMatchObject({
      ok: true,
      event: {
        kind: "ask_command",
        question: "Can you tell me about the Sivraj_Demo_Launch_Notes.pdf file",
      },
    });
  });

  it("normalizes plain URL messages as capture drops instead of questions", () => {
    const normalized = normalizeTelegramUpdate({
      update_id: 1012,
      message: {
        message_id: 55,
        date: 1781720300,
        text: "Can you read this https://example.com/fundraising for later",
        from: { id: 123456, username: "ada" },
        chat: { id: 123456, type: "private" },
      },
    });

    expect(normalized).toMatchObject({
      ok: true,
      event: {
        kind: "capture_text",
        text: "Can you read this https://example.com/fundraising for later",
      },
    });
  });

  it("normalizes explicit remember commands as capture text", () => {
    const normalized = normalizeTelegramUpdate({
      update_id: 1007,
      message: {
        message_id: 50,
        date: 1781719800,
        text: "/remember I am a lawyer",
        from: { id: 123456, username: "ada" },
        chat: { id: 123456, type: "private" },
      },
    });

    expect(normalized).toMatchObject({
      ok: true,
      event: {
        kind: "capture_text",
        text: "I am a lawyer",
      },
    });
  });

  it("keeps explicit memory phrases in capture mode even when they contain can you", () => {
    const normalized = normalizeTelegramUpdate({
      update_id: 1008,
      message: {
        message_id: 51,
        date: 1781719900,
        text: "Can you remember that I prefer morning investor calls on Tuesdays.",
        from: { id: 123456, username: "ada" },
        chat: { id: 123456, type: "private" },
      },
    });

    expect(normalized).toMatchObject({
      ok: true,
      event: {
        kind: "capture_text",
        text: "Can you remember that I prefer morning investor calls on Tuesdays.",
      },
    });
  });

  it("normalizes empty ask commands so the handler can return usage", () => {
    const normalized = normalizeTelegramUpdate({
      update_id: 1005,
      message: {
        message_id: 48,
        date: 1781719600,
        text: "/ask",
        from: { id: 123456, username: "ada" },
        chat: { id: 123456, type: "private" },
      },
    });

    expect(normalized).toMatchObject({
      ok: true,
      event: {
        kind: "ask_command",
        question: null,
      },
    });
  });

  it("normalizes media captures as deferred capture references", () => {
    const normalized = normalizeTelegramUpdate({
      update_id: 1003,
      message: {
        message_id: 46,
        date: 1781719400,
        caption: "Investor voice note",
        voice: {
          file_id: "voice-file-id",
          file_unique_id: "voice-unique-id",
          file_size: 1234,
          mime_type: "audio/ogg",
        },
        from: { id: 123456, username: "ada" },
        chat: { id: 123456, type: "private" },
      },
    });

    expect(normalized).toMatchObject({
      ok: true,
      event: {
        kind: "capture_media",
        mediaKind: "voice",
        fileId: "voice-file-id",
        fileUniqueId: "voice-unique-id",
        fileSize: 1234,
        mimeType: "audio/ogg",
        caption: "Investor voice note",
      },
    });
  });

  it("normalizes documents with file metadata", () => {
    const normalized = normalizeTelegramUpdate({
      update_id: 1013,
      message: {
        message_id: 56,
        date: 1781720400,
        document: {
          file_id: "document-file-id",
          file_unique_id: "document-unique-id",
          file_size: 42_000,
          file_name: "Launch Notes.pdf",
          mime_type: "application/pdf",
        },
        from: { id: 123456, username: "ada" },
        chat: { id: 123456, type: "private" },
      },
    });

    expect(normalized).toMatchObject({
      ok: true,
      event: {
        kind: "capture_media",
        mediaKind: "document",
        fileId: "document-file-id",
        fileUniqueId: "document-unique-id",
        fileSize: 42000,
        fileName: "Launch Notes.pdf",
        mimeType: "application/pdf",
      },
    });
  });

  it("normalizes the largest photo with file metadata", () => {
    const normalized = normalizeTelegramUpdate({
      update_id: 1014,
      message: {
        message_id: 57,
        date: 1781720500,
        photo: [
          { file_id: "small-photo-id", file_unique_id: "small-photo-unique-id", file_size: 10 },
          { file_id: "large-photo-id", file_unique_id: "large-photo-unique-id", file_size: 100 },
        ],
        from: { id: 123456, username: "ada" },
        chat: { id: 123456, type: "private" },
      },
    });

    expect(normalized).toMatchObject({
      ok: true,
      event: {
        kind: "capture_media",
        mediaKind: "photo",
        fileId: "large-photo-id",
        fileUniqueId: "large-photo-unique-id",
        fileSize: 100,
      },
    });
  });
});
