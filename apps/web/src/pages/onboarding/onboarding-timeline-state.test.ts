import { describe, expect, it } from 'vitest'
import {
  getOnboardingTimelineProgress,
  getTimelineStepVisualState,
} from '@/pages/onboarding/onboarding-timeline-state'

describe('onboarding timeline state', () => {
  it('computes progress percentages', () => {
    expect(getOnboardingTimelineProgress(0, 4)).toBe(0)
    expect(getOnboardingTimelineProgress(1, 4)).toBeCloseTo(33.333)
    expect(getOnboardingTimelineProgress(2, 4)).toBeCloseTo(66.667)
    expect(getOnboardingTimelineProgress(3, 4)).toBe(100)
  })

  it('derives step visual state', () => {
    expect(getTimelineStepVisualState({
      index: 1,
      activeIndex: 1,
      currentStepId: 'arrival',
      stepId: 'arrival',
      unlockedStepIndex: 2,
    })).toMatchObject({
      isActive: true,
      isComplete: false,
      isUnlocked: true,
    })
  })
})
