import type {
  TerminalCommandStatus,
  TerminalHistoryCursor,
  TerminalOutputLine,
} from "@/types/terminal.types";

export type TerminalState = {
  lines: TerminalOutputLine[];
  input: string;
  history: string[];
  historyCursor: TerminalHistoryCursor;
  status: TerminalCommandStatus;
};

export type TerminalAction =
  | { type: "input.changed"; value: string }
  | { type: "command.started"; input: string }
  | { type: "command.completed"; lines: TerminalOutputLine[] }
  | { type: "command.failed"; lines: TerminalOutputLine[] }
  | { type: "history.previous" }
  | { type: "history.next" }
  | { type: "clear" };

export const initialTerminalState: TerminalState = {
  lines: [
    {
      id: "terminal:ready",
      kind: "info",
      text: "Sivraj terminal ready :) Type help to begin.",
    },
  ],
  input: "",
  history: [],
  historyCursor: null,
  status: "idle",
};

export function terminalReducer(
  state: TerminalState,
  action: TerminalAction,
): TerminalState {
  switch (action.type) {
    case "input.changed":
      return { ...state, input: action.value, historyCursor: null };

    case "command.started": {
      const command = action.input.trim();
      return {
        ...state,
        status: "running",
        input: "",
        history: command
          ? [...state.history.filter((item) => item !== command), command]
          : state.history,
        historyCursor: null,
        lines: [
          ...state.lines,
          {
            id: `terminal:prompt:${state.lines.length}:${command}`,
            kind: "prompt",
            text: `> ${command}`,
          },
        ],
      };
    }

    case "command.completed":
      return {
        ...state,
        status: "success",
        lines: action.lines.length === 0
          ? initialTerminalState.lines
          : [...state.lines, ...withTerminalLineIds(action.lines, state.lines.length)],
      };

    case "command.failed":
      return {
        ...state,
        status: "failed",
        lines: [...state.lines, ...withTerminalLineIds(action.lines, state.lines.length)],
      };

    case "history.previous": {
      const cursor = state.historyCursor ?? state.history.length;
      const nextCursor = Math.max(0, cursor - 1);
      return {
        ...state,
        historyCursor: state.history.length > 0 ? nextCursor : null,
        input: state.history[nextCursor] ?? state.input,
      };
    }

    case "history.next": {
      if (state.historyCursor === null) {
        return state;
      }

      const nextCursor = state.historyCursor + 1;
      if (nextCursor >= state.history.length) {
        return { ...state, historyCursor: null, input: "" };
      }

      return {
        ...state,
        historyCursor: nextCursor,
        input: state.history[nextCursor] ?? "",
      };
    }

    case "clear":
      return {
        ...initialTerminalState,
        history: state.history,
      };
  }
}

export function isTerminalBusy(state: TerminalState) {
  return state.status === "running";
}

function withTerminalLineIds(
  lines: TerminalOutputLine[],
  startIndex: number,
): TerminalOutputLine[] {
  return lines.map((line, index) => ({
    ...line,
    id: line.id ?? `terminal:line:${startIndex + index}:${line.kind}:${line.text}`,
  }));
}
