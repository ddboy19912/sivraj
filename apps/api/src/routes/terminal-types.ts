export type TerminalCommandId =
  | "onboarding.status"
  | "onboarding.reset"
  | "connectors.list"
  | "connectors.sync"
  | "audit.recent";

export type TerminalCommandStatus = "success" | "failed";

export type TerminalOutputKind = "info" | "success" | "warning" | "error";

export type TerminalOutputLine = {
  kind: TerminalOutputKind;
  text: string;
};

export type TerminalCommandEffect = "clearSessionAndReload";

export type TerminalCommandResponse = {
  commandId: TerminalCommandId;
  status: TerminalCommandStatus;
  lines: TerminalOutputLine[];
  effects?: TerminalCommandEffect[];
};
