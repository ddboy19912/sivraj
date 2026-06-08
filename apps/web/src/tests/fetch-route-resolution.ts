import type { FetchRouteHandler } from '@/tests/fetch-mock'

export function resolveFetchRoute(
  route: FetchRouteHandler,
  url: URL,
  init?: RequestInit,
): Response | null | undefined {
  if (route instanceof Response) {
    return route
  }

  if (route.length > 0) {
    return (route as (url: URL, init?: RequestInit) => Response | null | undefined)(url, init)
  }

  return (route as () => Response)()
}

export function resolveConfiguredFetchRoute(
  routes: Record<string, FetchRouteHandler> | undefined,
  pathname: string,
  url: URL,
  init?: RequestInit,
) {
  const route = routes?.[pathname]
  return route ? resolveFetchRoute(route, url, init) : null
}
