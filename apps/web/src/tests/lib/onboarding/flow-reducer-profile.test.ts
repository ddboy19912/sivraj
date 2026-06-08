import { describe, expect, it } from 'vitest'
import { createInitialState } from '@/lib/onboarding/flow-reducer'
import { handleProfileLoadActions } from '@/lib/onboarding/flow-reducer-profile-load'

describe('handleProfileActions', () => {
  it('applies loaded profile data into onboarding state', () => {
    const state = createInitialState({
      token: 'token',
      refreshToken: 'refresh',
      expiresAt: '2026-06-04T20:22:22.384Z',
      twinId: 'twin-id',
      walletAddress: '0xabc',
    })

    const next = handleProfileLoadActions(state, {
      type: 'PROFILE_LOADED',
      payload: {
        profile: {
          twinId: 'twin-id',
          name: 'Nova',
        },
        identity: {
          twinId: 'twin-id',
          displayName: 'Nova',
          aliases: ['N'],
          emails: [],
          phones: [],
          handles: {},
          onboardingStatus: 'not_started',
          firstMeetIntroStatus: 'not_started',
          shouldPlayFirstMeetIntro: false,
          events: [],
          selfDescriptionArtifactId: null,
        },
        voiceResponse: null,
      },
    })

    expect(next?.form.twinNameInput).toBe('Nova')
    expect(next?.phase).toBe('ready_onboarding')
  })
})
