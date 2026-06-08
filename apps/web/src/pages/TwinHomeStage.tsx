import { AgentAudioVisualizerAura } from "@/components/agents-ui/agent-audio-visualizer-aura";
import { useAgentAudio } from "@/providers/agent-audio-context";

export function TwinHomeStage() {
  const { state, audioTrack } = useAgentAudio();

  return (
    <section
      className="absolute top-1/2 left-1/2 z-2 w-[min(76vw,760px)] -translate-x-1/2 -translate-y-1/2 [contain:layout_paint] max-[760px]:top-[54%] max-[760px]:w-[min(112vw,520px)]"
      aria-label="Sivraj agent UI"
    >
      <div
        data-aos="fade-up"
        className="relative grid min-h-0 aspect-square w-full place-items-center"
      >
        <AgentAudioVisualizerAura
          state={state}
          audioTrack={audioTrack}
          className="absolute inset-0 size-full [filter:drop-shadow(0_0_24px_rgba(var(--theme-color-rgb),0.34))_drop-shadow(0_0_78px_rgba(var(--theme-color-rgb),0.24))]"
        />
      </div>
    </section>
  );
}
