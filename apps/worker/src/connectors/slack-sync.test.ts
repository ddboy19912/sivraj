import { describe, expect, it } from "vitest";
import { buildSlackSyncSkipMetadata } from "./slack-sync.js";

describe("connector slack sync helpers", () => {
  it("builds skip metadata for empty channels", () => {
    expect(buildSlackSyncSkipMetadata("general")).toEqual({
      channelName: "general",
      messageCount: 0,
      skipped: true,
    });
  });
});
