import "@/tests/mocks/agent-visualizer";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppAmbientStage } from "@/components/app/AppAmbientStage";
import { AgentAudioTestProvider } from "@/tests/helpers/agent-audio";

describe("AppAmbientStage", () => {
  it("always renders the shader visualizer in a stable app-level stage", () => {
    render(
      <AgentAudioTestProvider value={{ state: "idle" }}>
        <AppAmbientStage />
      </AgentAudioTestProvider>,
    );

    const stage = screen.getByLabelText("Sivraj agent UI");
    const visualizer = screen.getByTestId("agent-visualizer");

    expect(stage).toHaveClass("[contain:layout_paint]");
    expect(visualizer).toHaveClass("size-full");
    expect(visualizer).toHaveAttribute("data-state", "idle");
    expect(screen.queryByText("READY")).not.toBeInTheDocument();
    expect(document.querySelector(".theme-presence-blob")).not.toBeInTheDocument();
  });

  it("passes the agent state through unchanged", () => {
    render(
      <AgentAudioTestProvider value={{ state: "speaking" }}>
        <AppAmbientStage />
      </AgentAudioTestProvider>,
    );

    expect(screen.getByTestId("agent-visualizer")).toHaveAttribute(
      "data-state",
      "speaking",
    );
  });

  it("does not render the homepage status HUD inside the visualizer stage", () => {
    render(
      <AgentAudioTestProvider value={{ state: "thinking" }}>
        <AppAmbientStage />
      </AgentAudioTestProvider>,
    );

    expect(screen.queryByText("AGENT_STATUS")).not.toBeInTheDocument();
    expect(screen.queryByText("THINKING")).not.toBeInTheDocument();
    expect(screen.getByTestId("agent-visualizer")).toHaveClass("size-full");
  });

  it("does not log presentation state during render", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      render(
        <AgentAudioTestProvider value={{ state: "listening" }}>
          <AppAmbientStage />
        </AgentAudioTestProvider>,
      );

      expect(logSpy).not.toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
    }
  });
});
