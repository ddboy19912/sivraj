export type TerminalCommandId =
  | "help"
  | "clear"
  | "whoami"
  | "session.clear"
  | "onboarding.status"
  | "onboarding.reset"
  | "connectors.list"
  | "connectors.sync"
  | "audit.recent";

export type TerminalCommandStatus = "idle" | "running" | "success" | "failed";

export type TerminalOutputKind =
  | "prompt"
  | "help"
  | "info"
  | "success"
  | "warning"
  | "error";

export type TerminalOutputLine = {
  id?: string;
  kind: TerminalOutputKind;
  text: string;
  command?: string;
  description?: string;
};

export type TerminalCommandEffect = "clearSessionAndReload";

export type TerminalCommandResult = {
  commandId: TerminalCommandId;
  status: "success" | "failed";
  lines: Array<Omit<TerminalOutputLine, "kind"> & {
    kind: Exclude<TerminalOutputKind, "prompt">;
  }>;
  effects?: TerminalCommandEffect[];
};

export type ParsedTerminalCommand =
  | { kind: "client"; commandId: "help" | "clear" | "whoami" | "session.clear" }
  | {
      kind: "api";
      commandId:
        | "onboarding.status"
        | "onboarding.reset"
        | "connectors.list"
        | "connectors.sync"
        | "audit.recent";
      args: string[];
      flags: Record<string, boolean | string>;
    };

export type TerminalParseResult =
  | { ok: true; command: ParsedTerminalCommand }
  | { ok: false; message: string };

export type TerminalHistoryCursor = number | null;
