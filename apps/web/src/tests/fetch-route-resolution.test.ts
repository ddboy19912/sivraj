import { describe, expect, it } from 'vitest'
import { jsonResponse } from '@/tests/helpers'
import { resolveConfiguredFetchRoute } from '@/tests/fetch-route-resolution'

describe('fetch route resolution', () => {
  it('resolves configured routes by pathname', () => {
    const url = new URL('http://127.0.0.1/custom')
    expect(resolveConfiguredFetchRoute({
      '/custom': jsonResponse({ ok: true }),
    }, '/custom', url)?.status).toBe(200)
  })
})
