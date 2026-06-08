import { describe, expect, it } from 'vitest'
import { getAppOverlay } from '@/lib/app/overlay'
import { createBootstrap } from '@/tests/fixtures/onboarding-fixtures'

describe('getAppOverlay', () => {
  it('selects the wallet auth overlay globally', () => {
    expect(
      getAppOverlay({
        status: 'wallet_auth',
        hasWallet: true,
        error: null,
        hasCompletionHint: false,
      }),
    ).toBe('wallet_auth')
  })

  it('selects onboarding from access state', () => {
    expect(
      getAppOverlay({
        status: 'onboarding',
        bootstrap: createBootstrap('not_started'),
      }),
    ).toBe('onboarding')
  })

  it('does not cover app-ready users', () => {
    expect(
      getAppOverlay({
        status: 'app_ready',
        bootstrap: createBootstrap('completed'),
      }),
    ).toBeNull()
  })
})
