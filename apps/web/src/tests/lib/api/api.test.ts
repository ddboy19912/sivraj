import { describe, expect, it } from 'vitest'
import { apiErrorMessage } from '@/lib/api'

describe('apiErrorMessage', () => {
  it('prefers server messages with storage wallet diagnostics', () => {
    expect(apiErrorMessage(503, {
      error: 'storage_wallet_insufficient_balance',
      message: 'Private memory storage needs more SUI before it can save this memory.',
      storageWallet: {
        balanceSui: '0.0012',
        requiredSui: '0.2',
        shortfallSui: '0.1988',
      },
    })).toBe(
      'Private memory storage needs more SUI before it can save this memory. Current: 0.0012 SUI. Needed: 0.2 SUI. Shortfall: 0.1988 SUI.',
    )
  })

  it('keeps legacy error fallback when no message is present', () => {
    expect(apiErrorMessage(503, { error: 'encrypted_storage_failed' })).toBe(
      '503: encrypted_storage_failed',
    )
  })
})
