import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Homepage } from "@/pages/Homepage";

describe("Homepage", () => {
  it("does not render the status HUD when the app is gated", () => {
    render(<Homepage statusHud={null} />);

    expect(screen.queryByLabelText(/AGENT_STATUS/u)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Sivraj agent UI")).not.toBeInTheDocument();
  });

  it("renders the status HUD as a homepage overlay", () => {
    render(
      <Homepage
        statusHud={{ label: "AGENT_STATUS", status: "READY" }}
      />,
    );

    const hud = screen.getByLabelText("AGENT_STATUS READY");

    expect(hud).toHaveClass("home-agent-status-hud");
    expect(screen.queryByLabelText("Sivraj agent UI")).not.toBeInTheDocument();
  });

  it("does not render voice controls on the homepage", () => {
    render(
      <Homepage
        statusHud={null}
        voiceChat={{
          state: {
            phase: "idle",
            activeEventId: null,
            activeThreadId: null,
            settings: null,
            settingsStatus: "idle",
            profile: null,
            userTranscript: null,
            assistantTranscript: null,
            partialAssistantTranscript: "",
            error: null,
            wakeSupported: false,
          },
          cancelVoiceTurn: vi.fn(),
          saveSettings: vi.fn(),
        } as never}
      />,
    );

    expect(screen.queryByLabelText("Voice chat")).not.toBeInTheDocument();
    expect(screen.queryByText("Press Space to start or stop")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Hold to talk")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/upload/i)).not.toBeInTheDocument();
  });

  it("renders recent voice transcript subtitles", () => {
    render(
      <Homepage
        statusHud={null}
        voiceChat={{
          state: {
            phase: "thinking",
            activeEventId: "voice-1",
            activeThreadId: null,
            settings: null,
            settingsStatus: "ready",
            profile: null,
            userTranscript: "Can you summarize the plan?",
            assistantTranscript: null,
            partialAssistantTranscript: "Yes, the stronger move is Cartesia realtime STT.",
            error: null,
            wakeSupported: false,
          },
          beginPushToTalk: vi.fn(),
          endPushToTalk: vi.fn(),
          cancelVoiceTurn: vi.fn(),
          saveSettings: vi.fn(),
        } as never}
      />,
    );

    expect(screen.getByLabelText("Voice transcript")).toBeInTheDocument();
    expect(screen.getByText("Can you summarize the plan?")).toBeInTheDocument();
    expect(screen.getByText("Yes, the stronger move is Cartesia realtime STT.")).toBeInTheDocument();
    expect(screen.getByText("You")).toBeInTheDocument();
    expect(screen.getByText("Sivraj")).toBeInTheDocument();
  });

  it("keeps voice subtitles compact", () => {
    const longTranscript = `${"memory ".repeat(40)}done`;

    render(
      <Homepage
        statusHud={null}
        voiceChat={{
          state: {
            phase: "transcribing",
            activeEventId: "voice-1",
            activeThreadId: null,
            settings: null,
            settingsStatus: "ready",
            profile: null,
            userTranscript: longTranscript,
            assistantTranscript: "Previous assistant line",
            partialAssistantTranscript: "",
            error: null,
            wakeSupported: false,
          },
          beginPushToTalk: vi.fn(),
          endPushToTalk: vi.fn(),
          cancelVoiceTurn: vi.fn(),
          saveSettings: vi.fn(),
        } as never}
      />,
    );

    const subtitle = screen.getByText(/memory memory/u);

    expect(subtitle.textContent?.length).toBeLessThanOrEqual(120);
    expect(subtitle.textContent).toMatch(/^…/u);
    expect(subtitle.textContent).toMatch(/done$/u);
    expect(screen.getByText("Previous assistant line")).toBeInTheDocument();
  });

  it("renders voice subtitles as plain text instead of raw markdown", () => {
    render(
      <Homepage
        statusHud={null}
        voiceChat={{
          state: {
            phase: "speaking",
            activeEventId: "voice-1",
            activeThreadId: null,
            settings: null,
            settingsStatus: "ready",
            profile: null,
            userTranscript: null,
            assistantTranscript: "**Callbacks and event handlers:** Use `closure` state.",
            partialAssistantTranscript: "",
            error: null,
            wakeSupported: false,
          },
          beginPushToTalk: vi.fn(),
          endPushToTalk: vi.fn(),
          cancelVoiceTurn: vi.fn(),
          saveSettings: vi.fn(),
        } as never}
      />,
    );

    expect(screen.getByText("Callbacks and event handlers: Use closure state.")).toBeInTheDocument();
    expect(screen.queryByText(/\*\*/u)).not.toBeInTheDocument();
    expect(screen.queryByText(/`/u)).not.toBeInTheDocument();
  });

  it("labels assistant subtitles with the twin name", () => {
    render(
      <Homepage
        statusHud={null}
        twinName="Nova"
        voiceChat={{
          state: {
            phase: "speaking",
            activeEventId: "voice-1",
            activeThreadId: null,
            settings: null,
            settingsStatus: "ready",
            profile: null,
            userTranscript: "Hello there",
            assistantTranscript: "Hi, I am here.",
            partialAssistantTranscript: "",
            error: null,
            wakeSupported: false,
          },
          beginPushToTalk: vi.fn(),
          endPushToTalk: vi.fn(),
          cancelVoiceTurn: vi.fn(),
          saveSettings: vi.fn(),
        } as never}
      />,
    );

    expect(screen.getByText("Nova")).toBeInTheDocument();
    expect(screen.queryByText("Sivraj")).not.toBeInTheDocument();
  });
});
