import type { Session } from './session'
import { clearSession, readStoredSession, storeSession } from './session'

export type { Session }

export const API_URL = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:3000'

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unexpected error.'
}

function isAuthError(error: unknown) {
  return error instanceof Error && error.message.includes('API session is invalid or expired')
}

function apiErrorMessage(status: number, payload: unknown) {
  if (payload && typeof payload === 'object' && 'error' in payload) {
    const error = (payload as { error?: unknown }).error
    return typeof error === 'string' ? `${status}: ${error}` : `API request failed (${status})`
  }

  return `API request failed (${status})`
}

export async function postJson<TResponse>(
  path: string,
  body: Record<string, unknown>,
  token?: string,
): Promise<TResponse> {
  const response = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
  const payload = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(apiErrorMessage(response.status, payload))
  }

  return payload as TResponse
}

export async function getJson<TResponse>(path: string, token?: string): Promise<TResponse> {
  const response = await fetch(`${API_URL}${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : undefined,
  })
  const payload = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(apiErrorMessage(response.status, payload))
  }

  return payload as TResponse
}

export async function refreshApiSession(session: Session): Promise<Session> {
  const payload = await postJson<Session & { userId: string }>('/v1/auth/refresh', {
    refreshToken: session.refreshToken,
    walletAddress: session.walletAddress,
  })

  const refreshed: Session = {
    token: payload.token,
    refreshToken: payload.refreshToken,
    expiresAt: payload.expiresAt,
    twinId: payload.twinId,
    walletAddress: payload.walletAddress,
  }

  storeSession(refreshed)
  return refreshed
}

export async function postAuthedJson<TResponse>(
  path: string,
  body: Record<string, unknown>,
  session: Session,
  onSessionRefreshed: (session: Session) => void,
): Promise<TResponse> {
  try {
    return await postJson<TResponse>(path, body, session.token)
  } catch (error) {
    if (!isAuthError(error)) {
      throw error
    }

    const refreshed = await refreshApiSession(session)
    onSessionRefreshed(refreshed)
    return postJson<TResponse>(path, body, refreshed.token)
  }
}

export async function postAuthedAudio(
  path: string,
  body: Record<string, unknown>,
  session: Session,
  onSessionRefreshed: (session: Session) => void,
): Promise<Blob> {
  try {
    return await postAudio(path, body, session.token)
  } catch (error) {
    if (!isAuthError(error)) {
      throw error
    }

    const refreshed = await refreshApiSession(session)
    onSessionRefreshed(refreshed)
    return postAudio(path, body, refreshed.token)
  }
}

export async function getAuthedJson<TResponse>(
  path: string,
  session: Session,
  onSessionRefreshed: (session: Session) => void,
): Promise<TResponse> {
  try {
    return await getJson<TResponse>(path, session.token)
  } catch (error) {
    if (!isAuthError(error)) {
      throw error
    }

    const refreshed = await refreshApiSession(session)
    onSessionRefreshed(refreshed)
    return getJson<TResponse>(path, refreshed.token)
  }
}

async function postAudio(
  path: string,
  body: Record<string, unknown>,
  token: string,
): Promise<Blob> {
  const response = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}))
    throw new Error(apiErrorMessage(response.status, payload))
  }

  return response.blob()
}

export function readSessionForTests(): Session | null {
  return readStoredSession()
}

export function resetSessionForTests() {
  clearSession()
}

export function storeSessionForTests(session: Session) {
  storeSession(session)
}
