import { describe, expect, it } from "vitest";
import { readBrowserHistoryContent } from "./browser-history-reader.js";
import { readCalendarId } from "./calendar-reader.js";
import { readGitHubRepoUrl } from "./github-reader.js";
import { readConnectorMetadataString } from "./metadata-reader.js";
import { readNotionPageId } from "./notion-reader.js";
import { readSlackChannelId } from "./slack-reader.js";

describe("readConnectorMetadataString", () => {
  it("returns trimmed metadata strings", () => {
    expect(readConnectorMetadataString({ query: " in:inbox " }, "query")).toBe("in:inbox");
    expect(readConnectorMetadataString({}, "query")).toBeNull();
  });
});

describe("readGitHubRepoUrl", () => {
  it("validates GitHub source URLs", () => {
    expect(readGitHubRepoUrl({
      uri: "https://github.com/sivraj/app",
      externalSourceId: "ignored",
      metadata: {},
      id: "source-1",
      connectorAccountId: "account-1",
      displayName: "App",
      status: "connected",
      cursor: null,
      lastSyncAt: null,
      nextSyncAt: null,
      errorCode: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })).toBe("https://github.com/sivraj/app");
  });
});

describe("readSlackChannelId", () => {
  it("extracts Slack channel ids", () => {
    expect(readSlackChannelId({
      externalSourceId: "C123ABC",
      uri: null,
      metadata: {},
      id: "source-1",
      connectorAccountId: "account-1",
      displayName: "general",
      status: "connected",
      cursor: null,
      lastSyncAt: null,
      nextSyncAt: null,
      errorCode: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })).toBe("C123ABC");
  });
});

describe("readCalendarId", () => {
  it("normalizes calendar ids", () => {
    expect(readCalendarId(null)).toBe("primary");
    expect(readCalendarId({
      externalSourceId: "google-calendar://team@group.calendar.google.com",
      uri: null,
      metadata: {},
      id: "source-1",
      connectorAccountId: "account-1",
      displayName: "Team",
      status: "connected",
      cursor: null,
      lastSyncAt: null,
      nextSyncAt: null,
      errorCode: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })).toBe("team@group.calendar.google.com");
  });
});

describe("readNotionPageId", () => {
  it("extracts Notion page ids from source URIs", () => {
    expect(readNotionPageId({
      uri: "",
      externalSourceId: "0123456789abcdef0123456789abcdef",
      metadata: {},
      id: "source-1",
      connectorAccountId: "account-1",
      displayName: "Page",
      status: "connected",
      cursor: null,
      lastSyncAt: null,
      nextSyncAt: null,
      errorCode: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })).toBe("0123456789abcdef0123456789abcdef");
  });
});

describe("readBrowserHistoryContent", () => {
  it("prefers source metadata content", () => {
    expect(readBrowserHistoryContent({
      metadata: { content: "url,title" },
      externalSourceId: "browser_history_import",
      uri: null,
      id: "source-1",
      connectorAccountId: "account-1",
      displayName: "History",
      status: "connected",
      cursor: null,
      lastSyncAt: null,
      nextSyncAt: null,
      errorCode: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }, {})).toBe("url,title");
  });
});
