import { vi } from 'vitest'
import { resolveConfiguredFetchRoute } from '@/tests/fetch-route-resolution'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function storageHealth() {
  return {
    ok: true,
    storage: {
      mode: 'encrypted_walrus',
      ready: true,
      checks: {
        authConfigured: true,
        databaseConfigured: true,
        sealConfigured: true,
        suiConfigured: true,
        uploadRelayConfigured: true,
        walrusConfigured: true,
      },
    },
  }
}

function bootstrapResponse(url: URL) {
  if (url.pathname === '/v1/twins/twin-id/profile') {
    return jsonResponse({
      twinId: 'twin-id',
      name: 'Jarvis',
    })
  }

  if (url.pathname === '/v1/twins/twin-id/identity-profile') {
    return jsonResponse({
      twinId: 'twin-id',
      displayName: 'John',
      aliases: ['John Doe'],
      emails: [],
      phones: [],
      handles: {},
      selfDescriptionArtifactId: 'artifact-id',
      onboardingStatus: 'completed',
      firstMeetIntroStatus: 'consumed',
      shouldPlayFirstMeetIntro: false,
      events: [],
    })
  }

  if (url.pathname === '/v1/twins/twin-id/voice/presets') {
    return jsonResponse({
      defaultVoiceId: 'warm_operator',
      presets: [],
    })
  }

  return null
}

export type FetchRouteHandler =
  | Response
  | (() => Response)
  | ((url: URL, init?: RequestInit) => Response | null | undefined)

export { resolveFetchRoute } from '@/tests/fetch-route-resolution'

export function createAppFetchMock(options: {
  routes?: Record<string, FetchRouteHandler>
  handler?: (url: URL, init?: RequestInit) => Response | null | undefined
}) {
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://127.0.0.1:3000')

    if (url.pathname === '/health/storage') {
      const healthResponse = resolveConfiguredFetchRoute(
        options.routes,
        '/health/storage',
        url,
        init,
      )
      if (healthResponse) {
        return Promise.resolve(healthResponse)
      }

      return Promise.resolve(jsonResponse(storageHealth()))
    }

    const routeResponse = resolveConfiguredFetchRoute(
      options.routes,
      url.pathname,
      url,
      init,
    )
    if (routeResponse) {
      return Promise.resolve(routeResponse)
    }

    const custom = options.handler?.(url, init)
    if (custom) {
      return Promise.resolve(custom)
    }

    const bootstrap = bootstrapResponse(url)
    if (bootstrap) {
      return Promise.resolve(bootstrap)
    }

    return Promise.resolve(new Response('Not found', { status: 404 }))
  })
}
