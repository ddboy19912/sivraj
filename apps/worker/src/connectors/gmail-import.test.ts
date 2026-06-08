import { describe, expect, it } from "vitest";
import {
  advanceGmailCursor,
  buildGmailSearchQuery,
  importGmailMessages,
  toEmailImportResult,
} from "./gmail-import.js";

describe("buildGmailSearchQuery", () => {
  it("appends after: filter when cursor is present", () => {
    expect(buildGmailSearchQuery("in:inbox")).toBe("in:inbox");
    expect(buildGmailSearchQuery("in:inbox", "1700000000000")).toBe("in:inbox after:1700000000");
  });
});

describe("advanceGmailCursor", () => {
  it("tracks the latest internal date", () => {
    expect(advanceGmailCursor(null, "100")).toBe("100");
    expect(advanceGmailCursor("100", "50")).toBe("100");
    expect(advanceGmailCursor("100", "200")).toBe("200");
    expect(advanceGmailCursor("100", undefined)).toBe("100");
  });
});

describe("toEmailImportResult", () => {
  it("maps gmail payloads into import results", () => {
    const raw = Buffer.from("hello").toString("base64").replace(/\+/g, "-").replace(/\//g, "_");
    expect(toEmailImportResult({
      id: "msg-1",
      threadId: "thread-1",
      internalDate: "123",
      raw,
    })).toMatchObject({
      messageId: "msg-1",
      threadId: "thread-1",
      content: "hello",
      metadata: { importer: "gmail_message", messageId: "msg-1" },
    });
    expect(toEmailImportResult({ id: "msg-1" })).toBeNull();
  });
});

describe("importGmailMessages", () => {
  it("imports messages from the Gmail API", async () => {
    const raw = Buffer.from("Subject: hi").toString("base64").replace(/\+/g, "-").replace(/\//g, "_");
    const fetcher = async (url: string | URL) => {
      const path = String(url);

      if (path.includes("/users/me/messages?")) {
        return new Response(JSON.stringify({ messages: [{ id: "msg-1" }] }), { status: 200 });
      }

      if (path.includes("/users/me/messages/msg-1")) {
        return new Response(JSON.stringify({
          id: "msg-1",
          threadId: "thread-1",
          internalDate: "200",
          raw,
        }), { status: 200 });
      }

      return new Response("not found", { status: 404 });
    };

    const result = await importGmailMessages({
      token: "token",
      query: "in:inbox",
      fetcher: fetcher as typeof fetch,
    });

    expect(result.messages).toHaveLength(1);
    expect(result.cursorAfter).toBe("200");
    expect(result.query).toBe("in:inbox");
  });
});
