import { screen } from '@testing-library/react'
import type { UserEvent } from '@testing-library/user-event'
import { vi } from 'vitest'
import { storeSessionForTests } from '@/lib/api'
import { resetClientEncryptionRuntimeForTests } from '@/lib/encryption'
import { markOnboardingCompleted } from '@/lib/onboarding/completion'
import type { Session } from '@/lib/session'
import { walletState } from '@/tests/mocks/wallet-kit'

const consoleSession: Session = {
  token: 'api-token',
  refreshToken: 'refresh-token',
  expiresAt: '2026-12-31T01:00:00.000Z',
  twinId: 'twin-id',
  walletAddress: '0x1234567890abcdef',
}

export function resetAuthenticatedConsoleSession() {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.stubEnv('VITE_SEAL_PACKAGE_ID', '0xpackage')
  vi.stubEnv('VITE_SEAL_POLICY_ID', '0xpolicy')
  vi.stubEnv('VITE_SEAL_KEY_SERVERS', '0xkeyserver')
  vi.stubEnv('VITE_SEAL_THRESHOLD', '1')
  resetClientEncryptionRuntimeForTests()
  localStorage.clear()
  walletState.account = { address: consoleSession.walletAddress }
  walletState.wallet = { name: 'Sui Wallet' }
  storeSessionForTests(consoleSession)
  markOnboardingCompleted(consoleSession)
}

type OpenConsolePageOptions = {
  waitForConsole?: boolean;
}

export async function openConsolePage(
  user: UserEvent,
  tabName?: string,
  options: OpenConsolePageOptions = {},
) {
  await user.click(screen.getByRole('button', { name: 'Testing Console' }))

  if (options.waitForConsole !== false) {
    await screen.findByRole('button', { name: 'Ingest' }, { timeout: 5000 })
  }

  if (tabName) {
    await user.click(
      await screen.findByRole('button', { name: tabName }, { timeout: 5000 }),
    )
  }
}
