import { describe, expect, it } from 'vitest'
import { handleAuthActions } from '@/lib/onboarding/flow-reducer-auth'
import { createInitialState, onboardingReducer } from '@/lib/onboarding/flow-reducer'

describe('onboardingReducer', () => {
  it('marks the flow busy while work is in flight', () => {
    const state = createInitialState(null)

    expect(onboardingReducer(state, { type: 'BUSY', value: true }).isBusy).toBe(true)
  })

  it('stores twin name input updates', () => {
    const state = createInitialState(null)

    expect(
      onboardingReducer(state, { type: 'SET_TWIN_NAME', value: 'Nova' }).form.twinNameInput,
    ).toBe('Nova')
  })

  it('moves into onboarding when begin is dispatched with a session', () => {
    const state = createInitialState({
      token: 'token',
      refreshToken: 'refresh',
      expiresAt: '2026-06-04T20:22:22.384Z',
      twinId: 'twin-id',
      walletAddress: '0xabc',
    })

    expect(handleAuthActions(state, { type: 'BEGIN' })?.phase).toBe('ready_onboarding')
  })
})
