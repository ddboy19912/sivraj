import type { ProviderConfigResponse } from '@/lib/chat/chat-api'

export type ProviderNavStatus = 'default' | 'connected' | 'local' | 'missing'

export function getProviderNavStatus(
  state: ProviderConfigResponse | null,
): ProviderNavStatus {
  if (state?.config?.status === 'connected') {
    return 'connected'
  }

  if (state?.fallback) {
    return 'default'
  }

  return 'missing'
}
