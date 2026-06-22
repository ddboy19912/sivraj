import type { Dispatch, RefObject } from "react";
import type { Session } from "@/lib/api";
import { postAuthedJson } from "@/lib/api";
import { applyTerminalEffects } from "@/lib/terminal/effects";
import { formatHelpLines } from "@/lib/terminal/command-registry";
import { parseTerminalCommand } from "@/lib/terminal/parse";
import { isTerminalBusy, type TerminalAction, type TerminalState } from "@/lib/terminal/reducer";
import type {
  ParsedTerminalCommand,
  TerminalCommandResult,
  TerminalOutputLine,
} from "@/types/terminal.types";

type UseTerminalCommandRunnerInput = {
  state: TerminalState;
  dispatch: Dispatch<TerminalAction>;
  session: Session | null;
  onSessionRefreshed: (session: Session) => void;
  inputRef: RefObject<HTMLInputElement | null>;
};

export function useTerminalCommandRunner({
  state,
  dispatch,
  session,
  onSessionRefreshed,
  inputRef,
}: UseTerminalCommandRunnerInput) {
  async function runCommand(rawInput: string) {
    const input = rawInput.trim();
    if (!input || isTerminalBusy(state)) {
      return;
    }

    if (state.pendingConfirmation) {
      await runConfirmationResponse({
        input,
        command: state.pendingConfirmation.command,
        dispatch,
        session,
        onSessionRefreshed,
        focusTerminalInput,
      });
      return;
    }

    dispatch({ type: "command.started", input });

    const parsed = parseTerminalCommand(input);
    if (!parsed.ok) {
      dispatch({
        type: "command.failed",
        lines: [{ kind: "error", text: parsed.message }],
      });
      focusTerminalInput();
      return;
    }

    if (session && shouldRequestAccountWipeConfirmation(parsed.command)) {
      dispatch({
        type: "confirmation.requested",
        confirmation: {
          command: confirmableAccountWipeCommand(parsed.command),
          lines: accountWipeConfirmationLines(session),
        },
      });
      focusTerminalInput();
      return;
    }

    await runParsedCommand({
      command: parsed.command,
      dispatch,
      session,
      onSessionRefreshed,
      focusTerminalInput,
    });
  }

  function focusTerminalInput() {
    window.requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  }

  return { runCommand };
}

async function runConfirmationResponse(input: {
  input: string;
  command: ParsedApiTerminalCommand;
  dispatch: Dispatch<TerminalAction>;
  session: Session | null;
  onSessionRefreshed: (session: Session) => void;
  focusTerminalInput: () => void;
}) {
  input.dispatch({ type: "command.started", input: input.input });

  const decision = readConfirmationDecision(input.input);
  if (decision === "cancel") {
    input.dispatch({
      type: "confirmation.cancelled",
      lines: [{ kind: "info", text: "Account wipe cancelled." }],
    });
    input.focusTerminalInput();
    return;
  }

  if (decision !== "confirm") {
    input.dispatch({
      type: "confirmation.invalid",
      lines: [{ kind: "warning", text: "Type Y to confirm or N to cancel." }],
    });
    input.focusTerminalInput();
    return;
  }

  await runParsedCommand(input);
}

async function runParsedCommand(input: {
  command: ParsedTerminalCommand;
  dispatch: Dispatch<TerminalAction>;
  session: Session | null;
  onSessionRefreshed: (session: Session) => void;
  focusTerminalInput: () => void;
}) {
  try {
    const result = await executeParsedCommand({
      command: input.command,
      session: input.session,
      onSessionRefreshed: input.onSessionRefreshed,
    });

    input.dispatch({
      type: result.status === "success" ? "command.completed" : "command.failed",
      lines: result.lines,
    });
    applyTerminalEffects(result.effects);
    input.focusTerminalInput();
  } catch (error) {
    input.dispatch({
      type: "command.failed",
      lines: [
        {
          kind: "error",
          text: error instanceof Error ? error.message : "Command failed.",
        },
      ],
    });
    input.focusTerminalInput();
  }
}

async function executeParsedCommand(input: {
  command: ParsedTerminalCommand;
  session: Session | null;
  onSessionRefreshed: (session: Session) => void;
}): Promise<TerminalCommandResult> {
  if (input.command.kind === "client") {
    return executeClientCommand(input.command.commandId, input.session);
  }

  if (!input.session) {
    return {
      commandId: input.command.commandId,
      status: "failed",
      lines: [{ kind: "error", text: "Sign in with your wallet first." }],
    };
  }

  return postAuthedJson<TerminalCommandResult>(
    `/v1/twins/${input.session.twinId}/terminal/commands`,
    {
      commandId: input.command.commandId,
      args: input.command.args,
      flags: input.command.flags,
    },
    input.session,
    input.onSessionRefreshed,
  );
}

function executeClientCommand(
  commandId: "help" | "clear" | "whoami" | "session.clear",
  session: Session | null,
): TerminalCommandResult {
  if (commandId === "help") {
    return {
      commandId,
      status: "success",
      lines: formatHelpLines(),
    };
  }

  if (commandId === "clear") {
    return {
      commandId,
      status: "success",
      lines: [],
    };
  }

  if (commandId === "session.clear") {
    return {
      commandId,
      status: "success",
      lines: [{ kind: "success", text: "Session cleared." }],
      effects: ["clearSessionAndReload"],
    };
  }

  if (!session) {
    return {
      commandId,
      status: "failed",
      lines: [{ kind: "error", text: "No active session." }],
    };
  }

  return {
    commandId,
    status: "success",
    lines: [
      { kind: "info", text: `Wallet: ${session.walletAddress}` },
      { kind: "info", text: `Twin: ${session.twinId}` },
      { kind: "info", text: `Session expires: ${session.expiresAt}` },
    ],
  };
}

type ParsedApiTerminalCommand = Extract<ParsedTerminalCommand, { kind: "api" }>;

function shouldRequestAccountWipeConfirmation(
  command: ParsedTerminalCommand,
): command is ParsedApiTerminalCommand & { commandId: "account.wipe" } {
  return command.kind === "api" &&
    command.commandId === "account.wipe" &&
    command.flags["dryRun"] !== true;
}

function confirmableAccountWipeCommand(
  command: ParsedApiTerminalCommand & { commandId: "account.wipe" },
): ParsedApiTerminalCommand {
  return {
    ...command,
    flags: {
      ...command.flags,
      confirm: true,
      dryRun: false,
    },
  };
}

function accountWipeConfirmationLines(session: Session | null): TerminalOutputLine[] {
  return [
    {
      kind: "warning",
      text: "This will wipe the current wallet account, twin, brain, chats, files, connectors, sessions, and local DB metadata.",
    },
    {
      kind: "warning",
      text: "Encrypted Walrus blobs may remain durable, but Sivraj will remove local references and future cryptographic access.",
    },
    {
      kind: "info",
      text: `Wallet: ${session?.walletAddress ?? "not signed in"}`,
    },
    {
      kind: "info",
      text: `Twin: ${session?.twinId ?? "not signed in"}`,
    },
    {
      kind: "warning",
      text: "Type Y to confirm or N to cancel.",
    },
  ];
}

function readConfirmationDecision(input: string): "confirm" | "cancel" | null {
  const normalized = input.trim().toLowerCase();
  if (normalized === "y" || normalized === "yes") {
    return "confirm";
  }
  if (normalized === "n" || normalized === "no") {
    return "cancel";
  }
  return null;
}
