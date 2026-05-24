export type Session = {
  token: string
  refreshToken: string
  expiresAt: string
  twinId: string
  walletAddress: string
}

export const SESSION_STORAGE_KEY = 'sivraj.session.v1'

export function readStoredSession(): Session | null {
  const raw = localStorage.getItem(SESSION_STORAGE_KEY)

  if (!raw) {
    return null
  }

  try {
    const parsed = JSON.parse(raw) as Partial<Session>

    if (
      typeof parsed.token === 'string' &&
      typeof parsed.refreshToken === 'string' &&
      typeof parsed.expiresAt === 'string' &&
      typeof parsed.twinId === 'string' &&
      typeof parsed.walletAddress === 'string'
    ) {
      return parsed as Session
    }
  } catch {
    return null
  }

  return null
}

export function storeSession(session: Session) {
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session))
}

export function clearSession() {
  localStorage.removeItem(SESSION_STORAGE_KEY)
}
