import { describe, expect, it } from 'vitest'
import {
  AURA_VISUALIZER_DEFAULTS,
  resolveAuraVisualizerValues,
} from '@/hooks/agents-ui/aura-visualizer-values'

describe('resolveAuraVisualizerValues', () => {
  it('returns idle defaults for disconnected states', () => {
    expect(resolveAuraVisualizerValues('idle', 0)).toMatchObject({
      speed: 10,
      brightness: 1,
    })
  })

  it('scales speaking visuals with volume', () => {
    expect(resolveAuraVisualizerValues('speaking', 0.5)).toMatchObject({
      scale: 0.31,
      brightness: 2,
    })
  })

  it('falls back to defaults for unknown states', () => {
    expect(resolveAuraVisualizerValues(undefined, 0)).toEqual(AURA_VISUALIZER_DEFAULTS)
  })
})
