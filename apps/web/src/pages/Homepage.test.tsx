import "@/tests/mocks/agent-visualizer";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Homepage } from "@/pages/Homepage";
import { AgentAudioTestProvider } from "@/tests/helpers/agent-audio";

describe("Homepage", () => {
  it("does not render the status HUD when the app is gated", () => {
    render(
      <AgentAudioTestProvider value={{ state: "idle" }}>
        <Homepage statusHud={null} />
      </AgentAudioTestProvider>,
    );

    expect(screen.getByTestId("agent-visualizer")).toHaveAttribute(
      "data-state",
      "idle",
    );
    expect(screen.queryByLabelText(/AGENT_STATUS/u)).not.toBeInTheDocument();
  });

  it("renders the status HUD as a homepage overlay outside the visualizer stage", () => {
    render(
      <AgentAudioTestProvider value={{ state: "initializing" }}>
        <Homepage
          statusHud={{ label: "AGENT_STATUS", status: "READY" }}
        />
      </AgentAudioTestProvider>,
    );

    const stage = screen.getByLabelText("Sivraj agent UI");
    const hud = screen.getByLabelText("AGENT_STATUS READY");

    expect(screen.getByTestId("agent-visualizer")).toHaveAttribute(
      "data-state",
      "initializing",
    );
    expect(hud).toHaveClass("home-agent-status-hud");
    expect(stage).not.toContainElement(hud);
  });
});
