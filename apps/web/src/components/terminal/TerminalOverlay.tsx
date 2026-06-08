import {
  type PointerEvent as ReactPointerEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import { Terminal, X } from "lucide-react";
import type { Session } from "@/lib/api";
import { postAuthedJson } from "@/lib/api";
import { applyTerminalEffects } from "@/lib/terminal/effects";
import { formatHelpLines } from "@/lib/terminal/command-registry";
import { parseTerminalCommand } from "@/lib/terminal/parse";
import {
  initialTerminalState,
  isTerminalBusy,
  terminalReducer,
} from "@/lib/terminal/reducer";
import { liquidGlass } from "@/lib/ui/liquid-glass";
import { cn } from "@/lib/ui/utils";
import type {
  ParsedTerminalCommand,
  TerminalCommandResult,
  TerminalOutputLine,
} from "@/types/terminal.types";

type TerminalOverlayProps = {
  enabled: boolean;
  session: Session | null;
  onSessionRefreshed: (session: Session) => void;
};

type Position = {
  x: number;
  y: number;
};

type DragState = {
  pointerId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
} | null;

const VIEWPORT_MARGIN = 16;

export function TerminalOverlay({
  enabled,
  session,
  onSessionRefreshed,
}: TerminalOverlayProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<Position | null>(null);
  const [state, dispatch] = useReducer(terminalReducer, initialTerminalState);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState>(null);
  const latestPositionRef = useRef<Position | null>(null);
  const isOpen = enabled && open;

  useEffect(() => {
    if (!enabled) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.ctrlKey && event.code === "Backquote") {
        event.preventDefault();
        setOpen((current) => !current);
        return;
      }

      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [enabled]);

  useLayoutEffect(() => {
    if (!isOpen || !panelRef.current) {
      return;
    }

    const rect = panelRef.current.getBoundingClientRect();
    const nextPosition = clampPosition(
      position ?? {
        x: 36,
        y: 92,
      },
      rect,
    );

    latestPositionRef.current = nextPosition;
    if (!position || !positionsEqual(position, nextPosition)) {
      setPosition(nextPosition);
    }
  }, [isOpen, position]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    inputRef.current?.focus();
  }, [isOpen]);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) {
      return;
    }

    if (typeof scroller.scrollTo === "function") {
      scroller.scrollTo({
        top: scroller.scrollHeight,
        behavior: "smooth",
      });
      return;
    }

    scroller.scrollTop = scroller.scrollHeight;
  }, [state.lines]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handleResize() {
      const panel = panelRef.current;
      const current = latestPositionRef.current;

      if (!panel || !current) {
        return;
      }

      const nextPosition = clampPosition(current, panel.getBoundingClientRect());
      latestPositionRef.current = nextPosition;
      setPosition(nextPosition);
    }

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [isOpen]);

  async function runCommand(rawInput: string) {
    const input = rawInput.trim();
    if (!input || isTerminalBusy(state)) {
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

    try {
      const result = await executeParsedCommand({
        command: parsed.command,
        session,
        onSessionRefreshed,
      });

      dispatch({
        type: result.status === "success" ? "command.completed" : "command.failed",
        lines: result.lines,
      });
      applyTerminalEffects(result.effects);
      focusTerminalInput();
    } catch (error) {
      dispatch({
        type: "command.failed",
        lines: [
          {
            kind: "error",
            text: error instanceof Error ? error.message : "Command failed.",
          },
        ],
      });
      focusTerminalInput();
    }
  }

  function focusTerminalInput() {
    window.requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  }

  function handleInputKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowUp") {
      event.preventDefault();
      dispatch({ type: "history.previous" });
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      dispatch({ type: "history.next" });
      return;
    }
  }

  function handleDragStart(event: ReactPointerEvent<HTMLElement>) {
    if (event.button !== 0 || !panelRef.current) {
      return;
    }

    const rect = panelRef.current.getBoundingClientRect();
    const origin = latestPositionRef.current ?? { x: rect.left, y: rect.top };
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: origin.x,
      originY: origin.y,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function handleDragMove(event: ReactPointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    const panel = panelRef.current;

    if (!drag || drag.pointerId !== event.pointerId || !panel) {
      return;
    }

    const nextPosition = clampPosition(
      {
        x: drag.originX + event.clientX - drag.startX,
        y: drag.originY + event.clientY - drag.startY,
      },
      panel.getBoundingClientRect(),
    );

    latestPositionRef.current = nextPosition;
    panel.style.left = `${nextPosition.x}px`;
    panel.style.top = `${nextPosition.y}px`;
  }

  function handleDragEnd(event: ReactPointerEvent<HTMLElement>) {
    const drag = dragRef.current;

    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    dragRef.current = null;
    setPosition(latestPositionRef.current);
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  }

  if (!isOpen) {
    return null;
  }

  const busy = isTerminalBusy(state);

  return (
    <section
      ref={panelRef}
      aria-label="Sivraj terminal"
      className={cn(
        liquidGlass,
        "fixed z-[80] flex h-[min(560px,calc(100svh-144px))] w-[min(760px,calc(100vw-32px))] flex-col overflow-hidden rounded-[24px] border border-white/12 shadow-[0_24px_80px_rgba(0,0,0,0.38)]",
      )}
      style={{
        left: position ? `${position.x}px` : undefined,
        top: position ? `${position.y}px` : undefined,
      }}
    >
      <header
        className="flex cursor-grab touch-none select-none items-center justify-between border-b border-white/10 px-4 py-3 active:cursor-grabbing"
        onPointerDown={handleDragStart}
        onPointerMove={handleDragMove}
        onPointerUp={handleDragEnd}
        onPointerCancel={handleDragEnd}
      >
        <div className="flex min-w-0 items-center gap-2">
          <Terminal className="size-4 shrink-0 text-[rgba(var(--theme-color-rgb),0.95)]" />
          <h2 className="truncate text-sm font-semibold text-white/90">
            Sivraj Terminal
          </h2>
        </div>
        <button
          type="button"
          aria-label="Close terminal"
          title="Close terminal"
          className="grid size-8 shrink-0 place-items-center rounded-full text-white/55 transition hover:bg-white/8 hover:text-white"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => setOpen(false)}
        >
          <X className="size-4" />
        </button>
      </header>

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto px-4 py-3 font-mono text-[13px] leading-6 text-white/82"
      >
        {state.lines.map(renderTerminalLine)}
      </div>

      <form
        className="flex items-center gap-2 border-t border-white/10 px-4 py-3 font-mono text-[13px]"
        onSubmit={(event) => {
          event.preventDefault();
          void runCommand(state.input);
        }}
      >
        <span className="text-[rgba(var(--theme-color-rgb),0.92)]">&gt;</span>
        <input
          ref={inputRef}
          aria-label="Terminal command"
          value={state.input}
          disabled={busy}
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder={busy ? "running..." : "help"}
          className="min-w-0 flex-1 bg-transparent text-white outline-none placeholder:text-white/28 disabled:text-white/38"
          onChange={(event) =>
            dispatch({ type: "input.changed", value: event.target.value })
          }
          onKeyDown={handleInputKeyDown}
        />
      </form>
    </section>
  );

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

function clampPosition(position: Position, rect: DOMRect): Position {
  const maxX = Math.max(VIEWPORT_MARGIN, window.innerWidth - rect.width - VIEWPORT_MARGIN);
  const maxY = Math.max(VIEWPORT_MARGIN, window.innerHeight - rect.height - VIEWPORT_MARGIN);

  return {
    x: Math.min(Math.max(VIEWPORT_MARGIN, position.x), maxX),
    y: Math.min(Math.max(VIEWPORT_MARGIN, position.y), maxY),
  };
}

function positionsEqual(left: Position, right: Position) {
  return left.x === right.x && left.y === right.y;
}

function lineClassName(kind: TerminalOutputLine["kind"]) {
  if (kind === "prompt") {
    return "text-[rgba(var(--theme-color-rgb),0.92)]";
  }

  if (kind === "success") {
    return "text-emerald-200";
  }

  if (kind === "warning") {
    return "text-amber-200";
  }

  if (kind === "error") {
    return "font-semibold text-red-500";
  }

  return "text-white/76";
}

function renderTerminalLine(line: TerminalOutputLine) {
  const key = terminalLineKey(line);

  if (line.kind === "help" && line.command && line.description) {
    return (
      <div
        key={key}
        className="grid grid-cols-[minmax(190px,240px)_minmax(0,1fr)] gap-5 py-0.5"
      >
        <code className="whitespace-pre-wrap text-[rgba(var(--theme-color-rgb),0.96)]">
          {line.command}
        </code>
        <span className="text-white/72">{line.description}</span>
      </div>
    );
  }

  return (
    <p key={key} className={lineClassName(line.kind)}>
      {line.text}
    </p>
  );
}

function terminalLineKey(line: TerminalOutputLine) {
  return line.id ?? `${line.kind}:${line.text}:${line.command ?? ""}:${line.description ?? ""}`;
}
