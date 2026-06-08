import { vi } from 'vitest'

vi.mock('@/components/agents-ui/agent-audio-visualizer-aura', () => ({
  AgentAudioVisualizerAura: ({
    className,
    state,
  }: {
    className?: string
    state?: string
  }) => (
    <div
      className={className}
      data-testid="agent-visualizer"
      data-state={state}
    />
  ),
}))
