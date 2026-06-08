import { describe, expect, it } from 'vitest'
import { createAppFetchMock, resolveFetchRoute } from '@/tests/fetch-mock'
import { jsonResponse } from '@/tests/helpers'

describe('fetch mock helpers', () => {
  it('resolves static and dynamic route handlers', () => {
    expect(resolveFetchRoute(jsonResponse({ ok: true }), new URL('http://127.0.0.1/health/storage'))?.status).toBe(200)

    expect(resolveFetchRoute(
      (url) => url.pathname === '/custom' ? jsonResponse({ custom: true }) : null,
      new URL('http://127.0.0.1/custom'),
    )?.status).toBe(200)
  })

  it('creates fetch mocks with bootstrap routes', async () => {
    const fetchMock = createAppFetchMock({})
    const response = await fetchMock('http://127.0.0.1/v1/twins/twin-id/profile')
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ twinId: 'twin-id' })
  })
})
