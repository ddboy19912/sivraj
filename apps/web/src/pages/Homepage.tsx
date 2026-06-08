import {
  AgentStatusHud,
  type AgentStatusHudState,
} from "@/components/ai/AgentStatusHud";
import { TwinHomeStage } from "@/pages/TwinHomeStage";

type HomepageProps = {
  statusHud?: AgentStatusHudState | null;
};

export function Homepage({ statusHud }: HomepageProps) {
  return (
    <>
      <TwinHomeStage />
      {statusHud ? (
        <AgentStatusHud
          label={statusHud.label}
          status={statusHud.status}
          active={statusHud.active}
          progress={statusHud.progress}
          className="home-agent-status-hud absolute right-[10vw] top-[30%] z-3 max-[900px]:right-6 max-[900px]:top-[22%] max-[640px]:right-1/2 max-[640px]:top-[18%] max-[640px]:translate-x-1/2 max-[640px]:scale-90"
        />
      ) : null}
    </>
  );
}
