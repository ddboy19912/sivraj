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

  it("keeps account wipe confirmation pending through invalid input and clears it on cancel", () => {
    const started = terminalReducer(initialTerminalState, {
      type: "command.started",
      input: "account wipe",
    });
    const pending = terminalReducer(started, {
      type: "confirmation.requested",
      confirmation: {
        command: {
          kind: "api",
          commandId: "account.wipe",
          args: [],
          flags: { confirm: true, dryRun: false },
        },
        lines: [{ kind: "warning", text: "Type Y to confirm or N to cancel." }],
      },
    });
    const invalid = terminalReducer(pending, {
      type: "confirmation.invalid",
      lines: [{ kind: "warning", text: "Type Y to confirm or N to cancel." }],
    });
    const cancelled = terminalReducer(invalid, {
      type: "confirmation.cancelled",
      lines: [{ kind: "info", text: "Account wipe cancelled." }],
    });

    expect(pending.pendingConfirmation?.command.commandId).toBe("account.wipe");
    expect(invalid.pendingConfirmation?.command.commandId).toBe("account.wipe");
    expect(cancelled.pendingConfirmation).toBeNull();
    expect(cancelled.lines.at(-1)?.text).toBe("Account wipe cancelled.");
  });
});
