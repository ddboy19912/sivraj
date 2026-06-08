import { vi } from 'vitest'

vi.mock('@/components/agents-ui/agent-audio-visualizer-aura', () => ({
  AgentAudioVisualizerAura: ({
    className,
    state,
    audioTrack,
  }: {
    className?: string
    state?: string
    audioTrack?: unknown
  }) => (
    <div
      className={className}
      data-testid="agent-visualizer"
      data-state={state}
      data-has-audio-track={audioTrack ? 'true' : 'false'}
    />
  ),
}))
