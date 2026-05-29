import { useState } from "react";
import type { AgentState } from "@livekit/components-react";
import { AgentAudioVisualizerAura } from "../components/agents-ui/agent-audio-visualizer-aura";
import "./AmbientUiPage.css";

const COLORS = [
  { id: "cyan", label: "Cyan", value: "#1FD5F9" },
  { id: "green", label: "Green", value: "#34F5A6" },
  { id: "violet", label: "Violet", value: "#8C7BFF" },
  { id: "amber", label: "Amber", value: "#FF9148" },
] as const;

const STATES: AgentState[] = ["idle", "listening", "thinking", "speaking"];

function AmbientUiPage() {
  const [color, setColor] = useState<(typeof COLORS)[number]["value"]>(
    COLORS[0].value,
  );
  const [state, setState] = useState<AgentState>("listening");

  return (
    <main className="livekit-ui-page">
      <div className="livekit-dot-grid" aria-hidden="true" />
      <section className="livekit-stage" aria-label="Sivraj agent UI">
        <AgentAudioVisualizerAura
          className="livekit-aura"
          state={state}
          color={color}
        />
      </section>
      <nav className="livekit-agent-state" aria-label="Agent state">
        {STATES.map((item) => (
          <button
            key={item}
            type="button"
            className={item === state ? "active" : ""}
            onClick={() => setState(item)}
          >
            {item}
          </button>
        ))}
      </nav>
      <aside className="livekit-color-control" aria-label="Aura color">
        {COLORS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={item.value === color ? "active" : ""}
            onClick={() => setColor(item.value)}
            aria-label={item.label}
          >
            <span style={{ background: item.value }} />
          </button>
        ))}
      </aside>
    </main>
  );
}

export default AmbientUiPage;
