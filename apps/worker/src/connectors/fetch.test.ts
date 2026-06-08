import { describe, expect, it } from "vitest";
import {
  decodeBase64Url,
  fetchGmailJson,
  fetchGoogleCalendarJson,
  fetchMicrosoftGraphJson,
  fetchNotionJson,
  fetchSlackJson,
  microsoftDriveItemPath,
} from "./fetch.js";

describe("decodeBase64Url", () => {
  it("decodes url-safe base64 payloads", () => {
    const encoded = Buffer.from("hello world").toString("base64").replace(/\+/g, "-").replace(/\//g, "_");
    expect(decodeBase64Url(encoded)).toBe("hello world");
  });
});

describe("microsoftDriveItemPath", () => {
  it("maps root and item ids", () => {
    expect(microsoftDriveItemPath("root")).toBe("/me/drive/root");
    expect(microsoftDriveItemPath("item/1")).toBe("/me/drive/items/item%2F1");
  });
});

describe("connector fetch helpers", () => {
  it("maps gmail 404 errors", async () => {
    const fetcher = async () => new Response("missing", { status: 404 });
    await expect(fetchGmailJson(fetcher as typeof fetch, "token", "/users/me/messages/1"))
      .rejects.toThrow("gmail_message_not_found");
  });

  it("maps gmail unauthorized errors", async () => {
    const fetcher = async () => new Response("nope", { status: 401 });
    await expect(fetchGmailJson(fetcher as typeof fetch, "token", "/users/me/messages"))
      .rejects.toThrow("gmail_unauthorized");
  });

  it("maps notion rate limits", async () => {
    const fetcher = async () => new Response("slow down", { status: 429 });
    await expect(fetchNotionJson(fetcher as typeof fetch, "token", "/pages/1"))
      .rejects.toThrow("notion_rate_limited");
  });

  it("maps google calendar failures", async () => {
    const fetcher = async () => new Response("bad", { status: 500 });
    await expect(fetchGoogleCalendarJson(fetcher as typeof fetch, "token", "/calendars/primary/events"))
      .rejects.toThrow("google_calendar_fetch_failed_500");
  });

  it("maps microsoft graph unauthorized errors", async () => {
    const fetcher = async () => new Response("nope", { status: 403 });
    await expect(fetchMicrosoftGraphJson(fetcher as typeof fetch, "token", "/me/drive/root"))
      .rejects.toThrow("microsoft_graph_unauthorized");
  });

  it("maps slack API failures", async () => {
    const fetcher = async () => new Response(JSON.stringify({ ok: false, error: "channel_not_found" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    await expect(fetchSlackJson(fetcher as typeof fetch, "token", "conversations.history", { channel: "C1" }))
      .rejects.toThrow("slack_channel_not_found");
  });

  it("maps slack rate limits", async () => {
    const fetcher = async () => new Response("slow", { status: 429 });
    await expect(fetchSlackJson(fetcher as typeof fetch, "token", "conversations.history", { channel: "C1" }))
      .rejects.toThrow("slack_rate_limited");
  });
});
