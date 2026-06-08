import { vi } from 'vitest'
import { createAppFetchMock, type FetchRouteHandler } from '@/tests/fetch-mock'

export function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

export function stubAppFetch(options: {
  routes?: Record<string, FetchRouteHandler>
  handler?: (url: URL, init?: RequestInit) => Response | null | undefined
}) {
  const fetchMock = createAppFetchMock(options)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}
