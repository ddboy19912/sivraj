import { describe, expect, it } from "vitest";
import {
  optionalMemorySearchLimit,
  parseMemorySearchRequestBody,
} from "./request.js";

describe("memory search request helpers", () => {
  it("parses memory search bodies", () => {
    expect(parseMemorySearchRequestBody({ query: "hello" })).toEqual({
      ok: true,
      query: "hello",
    });
    expect(parseMemorySearchRequestBody(null)).toMatchObject({
      error: { body: { error: "invalid_json_body" } },
    });
    expect(parseMemorySearchRequestBody({})).toMatchObject({
      error: { body: { error: "missing_query" } },
    });
  });

  it("reads optional limits", () => {
    expect(optionalMemorySearchLimit(4.8)).toBe(4);
    expect(optionalMemorySearchLimit("4")).toBeUndefined();
  });
});
