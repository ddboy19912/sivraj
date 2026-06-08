import { describe, expect, it } from "vitest";
import { isSuiBalanceSplitAbort } from "./sui-balance-errors.js";

describe("isSuiBalanceSplitAbort", () => {
  it("detects balance split aborts from error messages", () => {
    expect(isSuiBalanceSplitAbort(new Error(
      "MoveAbort abort code: 2 in balance::split",
    ))).toBe(true);
  });

  it("detects balance split aborts from structured execution errors", () => {
    const error = new Error("Transaction resolution failed") as Error & {
      executionError: {
        message: string;
        MoveAbort: { abortCode: string };
      };
    };
    error.executionError = {
      message: "MoveAbort abort code: 2 in balance::split",
      MoveAbort: { abortCode: "2" },
    };

    expect(isSuiBalanceSplitAbort(error)).toBe(true);
  });

  it("rejects unrelated errors", () => {
    expect(isSuiBalanceSplitAbort(new Error("storage node unavailable"))).toBe(false);
  });
});
