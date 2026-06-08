import { describe, expect, it } from "vitest";
import {
  initialTerminalState,
  isTerminalBusy,
  terminalReducer,
} from "@/lib/terminal/reducer";

describe("terminalReducer", () => {
  it("records commands and navigates history", () => {
    const started = terminalReducer(initialTerminalState, {
      type: "command.started",
      input: "whoami",
    });

    expect(started.history).toEqual(["whoami"]);
    expect(started.input).toBe("");
    expect(isTerminalBusy(started)).toBe(true);

    const completed = terminalReducer(started, {
      type: "command.completed",
      lines: [{ kind: "success", text: "done" }],
    });
    const previous = terminalReducer(completed, { type: "history.previous" });

    expect(isTerminalBusy(completed)).toBe(false);
    expect(previous.input).toBe("whoami");
  });

  it("clears output while preserving command history", () => {
    const started = terminalReducer(initialTerminalState, {
      type: "command.started",
      input: "help",
    });
    const cleared = terminalReducer(started, { type: "clear" });

    expect(cleared.history).toEqual(["help"]);
    expect(cleared.lines[0]?.text).toContain("Sivraj terminal ready");
  });
});
