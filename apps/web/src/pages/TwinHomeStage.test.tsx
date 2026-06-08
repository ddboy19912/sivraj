import "@/tests/mocks/agent-visualizer";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TwinHomeStage } from "@/pages/TwinHomeStage";

describe("TwinHomeStage", () => {
  it("always renders the shader visualizer in a stable stage", () => {
    render(<TwinHomeStage agentState="idle" />);

    const stage = screen.getByLabelText("Sivraj agent UI");
    const visualizer = screen.getByTestId("agent-visualizer");

    expect(stage).toHaveClass("[contain:layout_paint]");
    expect(visualizer).toHaveClass("size-full");
    expect(visualizer).toHaveAttribute("data-state", "idle");
    expect(screen.queryByText("READY")).not.toBeInTheDocument();
    expect(document.querySelector(".theme-presence-blob")).not.toBeInTheDocument();
  });

  it("passes the agent state through unchanged", () => {
    render(<TwinHomeStage agentState="speaking" />);

    expect(screen.getByTestId("agent-visualizer")).toHaveAttribute(
      "data-state",
      "speaking",
    );
  });

  it("does not render the homepage status HUD inside the visualizer stage", () => {
    render(<TwinHomeStage agentState="thinking" />);

    expect(screen.queryByText("AGENT_STATUS")).not.toBeInTheDocument();
    expect(screen.queryByText("THINKING")).not.toBeInTheDocument();
    expect(screen.getByTestId("agent-visualizer")).toHaveClass("size-full");
  });

  it("does not log presentation state during render", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      render(<TwinHomeStage agentState="listening" />);

      expect(logSpy).not.toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
    }
  });
});
