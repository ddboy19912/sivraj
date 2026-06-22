import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TerminalOverlay } from "@/components/terminal/TerminalOverlay";
import type { Session } from "@/lib/api";

const session: Session = {
  token: "token",
  refreshToken: "refresh",
  expiresAt: "2030-01-01T00:00:00.000Z",
  twinId: "twin-1",
  walletAddress: "0xabc",
};

describe("TerminalOverlay", () => {
  it("opens with the VS Code terminal shortcut only when enabled", () => {
    render(
      <TerminalOverlay
        enabled={false}
        session={session}
        onSessionRefreshed={vi.fn()}
      />,
    );

    fireEvent.keyDown(window, { ctrlKey: true, code: "Backquote" });
    expect(screen.queryByLabelText("Sivraj terminal")).not.toBeInTheDocument();
  });

  it("opens, runs local commands, and closes", async () => {
    const user = userEvent.setup();
    render(
      <TerminalOverlay
        enabled
        session={session}
        onSessionRefreshed={vi.fn()}
      />,
    );

    fireEvent.keyDown(window, { ctrlKey: true, code: "Backquote" });
    expect(screen.getByLabelText("Sivraj terminal")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Terminal command"), "whoami{Enter}");
    expect(await screen.findByText("Wallet: 0xabc")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByLabelText("Sivraj terminal")).not.toBeInTheDocument();
  });

  it("separates help command names from descriptions and clears output", async () => {
    const user = userEvent.setup();
    render(
      <TerminalOverlay
        enabled
        session={session}
        onSessionRefreshed={vi.fn()}
      />,
    );

    fireEvent.keyDown(window, { ctrlKey: true, code: "Backquote" });

    await user.type(screen.getByLabelText("Terminal command"), "help{Enter}");
    const clearCommand = await screen.findByText("clear");
    const clearDescription = screen.getByText("Clear terminal output.");

    expect(clearCommand.tagName.toLowerCase()).toBe("code");
    expect(clearDescription).toBeInTheDocument();

    await user.clear(screen.getByLabelText("Terminal command"));
    await user.type(screen.getByLabelText("Terminal command"), "clear{Enter}");

    expect(screen.queryByText("Clear terminal output.")).not.toBeInTheDocument();
    expect(screen.getByText("Sivraj terminal ready :) Type help to begin.")).toBeInTheDocument();
    expect(screen.getByLabelText("Terminal command")).toHaveFocus();
  });

  it("prompts before wiping the account and only posts after Y", async () => {
    const user = userEvent.setup();
    const originalFetch = globalThis.fetch;
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    globalThis.fetch = (async (url, init) => {
      calls.push({
        url: String(url),
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      });

      return new Response(JSON.stringify({
        commandId: "account.wipe",
        status: "success",
        lines: [{ kind: "success", text: "Account wipe complete." }],
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    try {
      render(
        <TerminalOverlay
          enabled
          session={session}
          onSessionRefreshed={vi.fn()}
        />,
      );

      fireEvent.keyDown(window, { ctrlKey: true, code: "Backquote" });

      await user.type(screen.getByLabelText("Terminal command"), "account wipe{Enter}");
      expect(await screen.findByText("Type Y to confirm or N to cancel.")).toBeInTheDocument();
      expect(calls).toHaveLength(0);

      await user.type(screen.getByLabelText("Terminal command"), "Y{Enter}");
      expect(await screen.findByText("Account wipe complete.")).toBeInTheDocument();
      expect(calls).toHaveLength(1);
      expect(calls[0]?.url).toContain("/v1/twins/twin-1/terminal/commands");
      expect(calls[0]?.body).toMatchObject({
        commandId: "account.wipe",
        flags: { confirm: true, dryRun: false },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("updates position while dragging and clamps to the viewport", () => {
    render(
      <TerminalOverlay
        enabled
        session={session}
        onSessionRefreshed={vi.fn()}
      />,
    );

    fireEvent.keyDown(window, { ctrlKey: true, code: "Backquote" });
    const panel = screen.getByLabelText("Sivraj terminal") as HTMLDivElement;
    vi.spyOn(panel, "getBoundingClientRect").mockReturnValue({
      width: 300,
      height: 240,
      left: 0,
      top: 0,
      right: 300,
      bottom: 240,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    const title = screen.getByText("Sivraj Terminal").closest("header");

    expect(title).not.toBeNull();
    fireEvent.pointerDown(title!, {
      button: 0,
      pointerId: 1,
      clientX: 10,
      clientY: 10,
    });
    fireEvent.pointerMove(title!, {
      pointerId: 1,
      clientX: -1000,
      clientY: -1000,
    });
    fireEvent.pointerUp(title!, { pointerId: 1 });

    expect(panel.style.left).toBe("16px");
    expect(panel.style.top).toBe("16px");
  });
});
