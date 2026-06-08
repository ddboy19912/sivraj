import { describe, expect, it } from "vitest";
import { resolveAuraVisualizerValues } from "@/hooks/agents-ui/aura-visualizer-values";

describe("resolveAuraVisualizerValues", () => {
  it("keeps completed idle usage calm", () => {
    expect(resolveAuraVisualizerValues("idle", 0)).toMatchObject({
      speed: 10,
      scale: 0.2,
      brightness: 1,
    });
  });

  it("maps thinking states to an active non-speaking aura", () => {
    expect(resolveAuraVisualizerValues("thinking", 0)).toMatchObject({
      speed: 30,
      scale: 0.3,
      frequency: 1,
    });
  });

  it("uses speaking volume to expand the aura", () => {
    expect(resolveAuraVisualizerValues("speaking", 0.5)).toMatchObject({
      speed: 70,
      scale: 0.31,
      brightness: 2,
    });
  });
});
