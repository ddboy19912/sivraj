import { describe, expect, it } from "vitest";
import { syncImportedGmailMessages } from "./gmail-sync.js";
import { createConnectorAdapterTestInput } from "../test/connector-fixtures.js";

describe("syncImportedGmailMessages", () => {
  it("skips when no gmail messages were imported", async () => {
    const inserts: unknown[] = [];
    const result = await syncImportedGmailMessages(createConnectorAdapterTestInput(inserts), {
      messages: [],
      cursorAfter: null,
      query: "in:inbox",
    });

    expect(result.skippedCount).toBe(1);
    expect(inserts).toHaveLength(1);
  });
});
