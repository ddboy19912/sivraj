import type { TerminalParseResult } from "@/types/terminal.types";

const SUPPORTED_FLAGS = new Set(["confirm", "dry-run"]);

export function parseTerminalCommand(input: string): TerminalParseResult {
  const tokens = tokenize(input);

  if (tokens.length === 0) {
    return { ok: false, message: "Type help to see supported commands." };
  }

  const [root, subcommand, ...rest] = tokens;
  const parsed = parseArgsAndFlags(rest);

  if (!parsed.ok) {
    return parsed;
  }

  if (root === "help") {
    return { ok: true, command: { kind: "client", commandId: "help" } };
  }

  if (root === "clear") {
    return { ok: true, command: { kind: "client", commandId: "clear" } };
  }

  if (root === "whoami") {
    return { ok: true, command: { kind: "client", commandId: "whoami" } };
  }

  if (root === "session" && subcommand === "clear") {
    return { ok: true, command: { kind: "client", commandId: "session.clear" } };
  }

  if ((root === "account" && subcommand === "wipe") || (root === "wipe" && subcommand === "account")) {
    if (parsed.flags["confirm"] === true) {
      return {
        ok: false,
        message: "Use account wipe and answer Y to confirm.",
      };
    }

    return {
      ok: true,
      command: {
        kind: "api",
        commandId: "account.wipe",
        args: parsed.args,
        flags: {
          dryRun: parsed.flags["dry-run"] === true,
          confirm: false,
        },
      },
    };
  }

  if (root === "onboarding" && subcommand === "status") {
    return {
      ok: true,
      command: {
        kind: "api",
        commandId: "onboarding.status",
        args: parsed.args,
        flags: parsed.flags,
      },
    };
  }

  if (root === "onboarding" && subcommand === "reset") {
    return {
      ok: true,
      command: {
        kind: "api",
        commandId: "onboarding.reset",
        args: parsed.args,
        flags: {
          dryRun: parsed.flags["confirm"] !== true,
          confirm: parsed.flags["confirm"] === true,
        },
      },
    };
  }

  if (root === "connectors" && subcommand === "list") {
    return {
      ok: true,
      command: {
        kind: "api",
        commandId: "connectors.list",
        args: parsed.args,
        flags: parsed.flags,
      },
    };
  }

  if (root === "connectors" && subcommand === "sync") {
    if (!parsed.args[0]) {
      return { ok: false, message: "Usage: connectors sync <accountId>" };
    }

    return {
      ok: true,
      command: {
        kind: "api",
        commandId: "connectors.sync",
        args: parsed.args,
        flags: parsed.flags,
      },
    };
  }

  if (root === "audit" && subcommand === "recent") {
    return {
      ok: true,
      command: {
        kind: "api",
        commandId: "audit.recent",
        args: parsed.args,
        flags: parsed.flags,
      },
    };
  }

  return {
    ok: false,
    message: `Unknown command: ${tokens.join(" ")}. Type help to see supported commands.`,
  };
}

function tokenize(input: string): string[] {
  return input.trim().split(/\s+/).filter(Boolean);
}

function parseArgsAndFlags(tokens: string[]):
  | { ok: true; args: string[]; flags: Record<string, boolean | string> }
  | { ok: false; message: string } {
  const args: string[] = [];
  const flags: Record<string, boolean | string> = {};

  for (const token of tokens) {
    if (!token.startsWith("--")) {
      args.push(token);
      continue;
    }

    const [rawFlag, value] = token.slice(2).split("=", 2);
    if (!SUPPORTED_FLAGS.has(rawFlag)) {
      return {
        ok: false,
        message: `Unsupported flag: --${rawFlag}. Type help to see supported commands.`,
      };
    }

    flags[rawFlag] = value ?? true;
  }

  return { ok: true, args, flags };
}
