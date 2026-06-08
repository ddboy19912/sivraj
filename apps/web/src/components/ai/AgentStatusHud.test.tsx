import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AgentStatusHud } from "@/components/ai/AgentStatusHud";

describe("AgentStatusHud", () => {
  it("renders a ready HUD by default", () => {
    render(<AgentStatusHud />);

    expect(screen.getByText("AGENT_STATUS")).toBeInTheDocument();
    expect(screen.getByText("READY")).toBeInTheDocument();
    expect(document.querySelectorAll(".agent-hud-bar")).toHaveLength(9);
    expect(document.querySelector(".agent-hud-progress")).toBeInTheDocument();
  });

  it("renders active status copy and bar elements", () => {
    render(<AgentStatusHud status="THINKING" active />);

    expect(screen.getByText("THINKING")).toBeInTheDocument();
    expect(screen.getByLabelText("AGENT_STATUS THINKING")).toHaveAttribute(
      "data-active",
      "true",
    );
  });
});
