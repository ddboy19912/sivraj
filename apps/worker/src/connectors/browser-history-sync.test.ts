import { describe, expect, it } from "vitest";
import { syncBrowserHistoryConnector } from "./browser-history-sync.js";

describe("syncBrowserHistoryConnector", () => {
  it("skips when browser history content is missing", async () => {
    const inserts: unknown[] = [];
    const adapterInput = {
      db: { insert: () => ({ values: async (value: unknown) => { inserts.push(value); } }) },
      syncRun: { id: "run-1", twinId: "twin-1" },
      account: { id: "account-1", cursor: null, syncCadence: "manual" as const, metadata: {} },
      source: null,
      privateSourceStorage: {},
      artifactProcessingQueue: {},
    } as never;

    const result = await syncBrowserHistoryConnector(adapterInput);

    expect(result.skippedCount).toBe(1);
    expect(inserts).toHaveLength(1);
  });
});
