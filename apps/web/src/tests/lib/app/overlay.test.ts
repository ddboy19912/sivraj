import { describe, expect, it } from 'vitest'
import { getAppOverlay, shouldShowMainNavigation } from '@/lib/app/overlay'
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

describe('shouldShowMainNavigation', () => {
  it('hides app navigation while global overlays own the shell', () => {
    expect(shouldShowMainNavigation('pending')).toBe(false)
    expect(shouldShowMainNavigation('wallet_auth')).toBe(false)
    expect(shouldShowMainNavigation('onboarding')).toBe(false)
  })

  it('shows app navigation for app-ready users', () => {
    expect(shouldShowMainNavigation(null)).toBe(true)
  })
})
