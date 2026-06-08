import { describe, expect, it } from 'vitest'
import { getProviderNavStatus } from '@/lib/navigation/provider-status'

describe('getProviderNavStatus', () => {
  it('maps missing provider config', () => {
    expect(getProviderNavStatus(null)).toBe('missing')
  })

  it('maps connected remote provider config', () => {
    expect(
      getProviderNavStatus({
        fallback: null,
        config: {
          id: 'config-id',
          providerKind: 'openrouter',
          displayName: 'OpenRouter',
          baseUrl: 'https://openrouter.ai/api/v1',
          model: 'model',
          status: 'connected',
          hasApiKey: true,
          lastTestedAt: null,
          updatedAt: null,
        },
      }),
    ).toBe('connected')
  })

  it('maps local provider config', () => {
    expect(
      getProviderNavStatus({
        fallback: null,
        config: {
          id: 'config-id',
          providerKind: 'ollama',
          displayName: 'Ollama',
          baseUrl: 'http://127.0.0.1:11434/v1',
          model: 'model',
          status: 'connected',
          hasApiKey: false,
          lastTestedAt: null,
          updatedAt: null,
        },
      }),
    ).toBe('local')
  })
})
