import { describe, expect, it } from "vitest";
import { nextSyncAt, syncCadenceToMs } from "./sync-timing.js";

describe("syncCadenceToMs", () => {
  it("maps known sync cadences", () => {
    expect(syncCadenceToMs("hourly")).toBe(3_600_000);
    expect(syncCadenceToMs("daily")).toBe(86_400_000);
    expect(syncCadenceToMs("weekly")).toBe(604_800_000);
    expect(syncCadenceToMs("every_15_minutes")).toBe(900_000);
    expect(syncCadenceToMs("manual")).toBeNull();
  });
});

describe("nextSyncAt", () => {
  it("schedules the next sync from a known cadence", () => {
    const from = new Date("2026-01-01T00:00:00.000Z");
    expect(nextSyncAt("hourly", from)?.toISOString()).toBe("2026-01-01T01:00:00.000Z");
  });
});
