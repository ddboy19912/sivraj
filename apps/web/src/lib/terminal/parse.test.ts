import { describe, expect, it } from "vitest";
import { parseTerminalCommand } from "@/lib/terminal/parse";

describe("parseTerminalCommand", () => {
  it("parses supported client and API commands", () => {
    expect(parseTerminalCommand("help")).toMatchObject({
      ok: true,
      command: { kind: "client", commandId: "help" },
    });
    expect(parseTerminalCommand("clear")).toMatchObject({
      ok: true,
      command: { kind: "client", commandId: "clear" },
    });
    expect(parseTerminalCommand("onboarding reset --confirm")).toMatchObject({
      ok: true,
      command: {
        kind: "api",
        commandId: "onboarding.reset",
        flags: { confirm: true, dryRun: false },
      },
    });
    expect(parseTerminalCommand("connectors sync account-1")).toMatchObject({
      ok: true,
      command: {
        kind: "api",
        commandId: "connectors.sync",
        args: ["account-1"],
      },
    });
    expect(parseTerminalCommand("audit recent 3")).toMatchObject({
      ok: true,
      command: { kind: "api", commandId: "audit.recent", args: ["3"] },
    });
  });

  it("rejects unknown commands and flags", () => {
    expect(parseTerminalCommand("rm -rf /")).toMatchObject({
      ok: false,
      message: expect.stringContaining("Unknown command"),
    });
    expect(parseTerminalCommand("onboarding reset --force")).toMatchObject({
      ok: false,
      message: expect.stringContaining("Unsupported flag"),
    });
  });
});
