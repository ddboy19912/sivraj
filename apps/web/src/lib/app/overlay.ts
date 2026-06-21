import type { AppAccessState } from '@/types/wallet.types'

export type AppOverlay = 'pending' | 'wallet_auth' | 'onboarding' | null

export function getAppOverlay(accessState: AppAccessState): AppOverlay {
  switch (accessState.status) {
    case 'pending':
    case 'fatal_error':
      return 'pending'
    case 'wallet_auth':
    case 'signing':
      return 'wallet_auth'
    case 'onboarding':
      return 'onboarding'
    case 'app_ready':
      return null
  }
}

export function shouldShowMainNavigation(overlay: AppOverlay): boolean {
  return overlay === null
}
