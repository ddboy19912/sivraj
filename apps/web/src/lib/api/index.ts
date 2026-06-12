import type { Session } from '@/lib/session'
import { clearSession, readStoredSession, storeSession } from '@/lib/session'

export type { Session }

export const API_URL = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:3000'

const refreshRequests = new Map<string, Promise<Session>>()

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unexpected error.'
}

export function isAuthError(error: unknown) {
  return error instanceof Error && error.message.includes('API session is invalid or expired')
}

export function apiErrorMessage(status: number, payload: unknown) {
  if (status === 401) {
    return 'API session is invalid or expired. Sign in with your wallet again.'
  }

  if (payload && typeof payload === 'object') {
    const errorPayload = payload as { error?: unknown; message?: unknown; storageWallet?: unknown }
    if (errorPayload.error === 'llm_credential_encryption_not_configured') {
      return typeof errorPayload.message === 'string'
        ? errorPayload.message
        : 'Provider credential encryption is not configured on the API.'
    }

    const message = typeof errorPayload.message === 'string'
      ? errorPayload.message
      : null
    const storageWalletDetails = storageWalletErrorDetails(errorPayload.storageWallet)

    if (message) {
      return storageWalletDetails ? `${message} ${storageWalletDetails}` : message
    }

    if ('error' in errorPayload) {
      const error = errorPayload.error
      return typeof error === 'string' ? `${status}: ${error}` : `API request failed (${status})`
    }
  }

  return `API request failed (${status})`
}

function storageWalletErrorDetails(value: unknown) {
  if (!value || typeof value !== 'object') {
    return null
  }

  const storageWallet = value as {
    balanceSui?: unknown
    requiredSui?: unknown
    shortfallSui?: unknown
  }

  if (
    typeof storageWallet.balanceSui !== 'string' ||
    typeof storageWallet.requiredSui !== 'string' ||
    typeof storageWallet.shortfallSui !== 'string'
  ) {
    return null
  }

  return `Current: ${storageWallet.balanceSui} SUI. Needed: ${storageWallet.requiredSui} SUI. Shortfall: ${storageWallet.shortfallSui} SUI.`
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

async function putJson<TResponse>(
  path: string,
  body: Record<string, unknown>,
  token?: string,
): Promise<TResponse> {
  const response = await fetch(`${API_URL}${path}`, {
    method: 'PUT',
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

async function getJson<TResponse>(path: string, token?: string): Promise<TResponse> {
  const response = await fetch(`${API_URL}${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : undefined,
  })
  const payload = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(apiErrorMessage(response.status, payload))
  }

  return payload as TResponse
}

async function deleteJson<TResponse>(path: string, token?: string): Promise<TResponse> {
  const response = await fetch(`${API_URL}${path}`, {
    method: 'DELETE',
    headers: token ? { authorization: `Bearer ${token}` } : undefined,
  })
  const payload = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(apiErrorMessage(response.status, payload))
  }

  return payload as TResponse
}

async function refreshApiSession(session: Session): Promise<Session> {
  const storedSession = readStoredSession()
  if (storedSession && isNewerSessionForSameWallet(session, storedSession)) {
    return storedSession
  }

  const refreshKey = `${session.walletAddress}:${session.refreshToken}`
  const activeRefresh = refreshRequests.get(refreshKey)

  if (activeRefresh) {
    return activeRefresh
  }

  const refreshRequest = postJson<Session & { userId: string }>('/v1/auth/refresh', {
    refreshToken: session.refreshToken,
    walletAddress: session.walletAddress,
  }).then((payload) => {
    const refreshed: Session = {
      token: payload.token,
      refreshToken: payload.refreshToken,
      expiresAt: payload.expiresAt,
      twinId: payload.twinId,
      walletAddress: payload.walletAddress,
    }

    storeSession(refreshed)
    return refreshed
  }).catch((error) => {
    const latestSession = readStoredSession()

    if (latestSession && isNewerSessionForSameWallet(session, latestSession)) {
      return latestSession
    }

    clearSession()
    throw error
  }).finally(() => {
    refreshRequests.delete(refreshKey)
  })

  refreshRequests.set(refreshKey, refreshRequest)
  return refreshRequest
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

export async function putAuthedJson<TResponse>(
  path: string,
  body: Record<string, unknown>,
  session: Session,
  onSessionRefreshed: (session: Session) => void,
): Promise<TResponse> {
  try {
    return await putJson<TResponse>(path, body, session.token)
  } catch (error) {
    if (!isAuthError(error)) {
      throw error
    }

    const refreshed = await refreshApiSession(session)
    onSessionRefreshed(refreshed)
    return putJson<TResponse>(path, body, refreshed.token)
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

export async function getAuthedAudio(
  path: string,
  session: Session,
  onSessionRefreshed: (session: Session) => void,
): Promise<Blob> {
  try {
    return await getAudio(path, session.token)
  } catch (error) {
    if (!isAuthError(error)) {
      throw error
    }

    const refreshed = await refreshApiSession(session)
    onSessionRefreshed(refreshed)
    return getAudio(path, refreshed.token)
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

export async function deleteAuthedJson<TResponse>(
  path: string,
  session: Session,
  onSessionRefreshed: (session: Session) => void,
): Promise<TResponse> {
  try {
    return await deleteJson<TResponse>(path, session.token)
  } catch (error) {
    if (!isAuthError(error)) {
      throw error
    }

    const refreshed = await refreshApiSession(session)
    onSessionRefreshed(refreshed)
    return deleteJson<TResponse>(path, refreshed.token)
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

  return readAudioResponse(response)
}

async function getAudio(path: string, token: string): Promise<Blob> {
  const response = await fetch(`${API_URL}${path}`, {
    headers: {
      authorization: `Bearer ${token}`,
    },
  })

  return readAudioResponse(response)
}

async function readAudioResponse(response: Response): Promise<Blob> {
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}))
    throw new Error(apiErrorMessage(response.status, payload))
  }

  return response.blob()
}

function isNewerSessionForSameWallet(
  staleSession: Session,
  candidateSession: Session,
) {
  return (
    staleSession.walletAddress === candidateSession.walletAddress &&
    staleSession.twinId === candidateSession.twinId &&
    staleSession.refreshToken !== candidateSession.refreshToken
  )
}
