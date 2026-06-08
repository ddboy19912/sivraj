import { describe, expect, it } from "vitest";
import { asString } from "@/helpers/data.helpers";
import { isRecord } from "@/lib/ai-chat/is-record";

describe("ai chat parse guards", () => {
  it("detects plain objects", () => {
    expect(isRecord({ id: "1" })).toBe(true);
    expect(isRecord(null)).toBe(false);
    expect(isRecord([])).toBe(false);
  });

  it("coerces non-empty strings", () => {
    expect(asString("  hello  ")).toBe("hello");
    expect(asString("   ")).toBeUndefined();
    expect(asString(42)).toBeUndefined();
  });
});
