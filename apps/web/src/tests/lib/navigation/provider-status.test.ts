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
        activeConfig: null,
        configs: [],
        config: {
          id: 'config-id',
          providerKind: 'openrouter',
          displayName: 'OpenRouter',
          baseUrl: 'https://openrouter.ai/api/v1',
          model: 'model',
          status: 'connected',
          isActive: true,
          authMethod: 'openrouter_pkce',
          hasApiKey: true,
          lastTestedAt: null,
          updatedAt: null,
        },
      }),
    ).toBe('connected')
  })

  it('maps fallback provider config', () => {
    expect(
      getProviderNavStatus({
        config: null,
        activeConfig: null,
        configs: [],
        fallback: {
          providerKind: 'openai',
          displayName: 'Gemini',
          baseUrl: 'https://api.openai.com',
          model: 'google/gemini-3.1-flash-lite',
          source: 'env',
        },
      }),
    ).toBe('default')
  })
})
