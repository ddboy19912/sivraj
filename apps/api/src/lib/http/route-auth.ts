import type { AuthClaims } from "@sivraj/auth";
import { agentWritebacks, sourceArtifacts } from "@sivraj/db";
import { and, eq } from "drizzle-orm";
import type { Context } from "hono";
import type { AppDependencies } from "../../app.js";
import { hasActiveAgentGrantForScopes } from "../agent-grants.js";
import {
  requireAnyScope,
  requireScope,
  type AuthEnv,
} from "../../middleware/auth.js";
import {
  findSourceArtifact,
  parseJsonObjectBody,
  readOptionalQueryUuid,
  type JsonObjectBodyResult,
} from "./route-helpers.js";

export type AuthorizedTwin = {
  auth: AuthClaims;
  twinId: string;
};

export type AuthorizedJsonBody = AuthorizedTwin & {
  body: Record<string, unknown>;
};

export type RouteAuthResult =
  | { ok: true; value: AuthorizedTwin }
  | { ok: false; response: Response };

export type RouteGateResult<T> =
  | { ok: true; value: T }
  | { ok: false; response: Response };

export type AuthorizedArtifactRoute = AuthorizedTwin & {
  artifact: typeof sourceArtifacts.$inferSelect;
};

export type AuthorizedWritebackRoute = AuthorizedTwin & {
  writebackId: string;
};

export function authorizeTwinRoute(
  c: Context<AuthEnv>,
  scope?: string,
): RouteAuthResult {
  const scopeError = scope ? requireScope(c, scope) : null;

  if (scopeError) {
    return { ok: false, response: scopeError };
  }

  return authorizeTwin(c);
}

export function authorizeTwinRouteWithAnyScope(
  c: Context<AuthEnv>,
  scopes: readonly string[],
): RouteAuthResult {
  const scopeError = requireAnyScope(c, scopes);

  if (scopeError) {
    return { ok: false, response: scopeError };
  }

  return authorizeTwin(c);
}

export async function authorizeTwinRouteWithAgentGrant(
  c: Context<AuthEnv>,
  input: {
    scope?: string;
    scopes?: readonly string[];
    db: AppDependencies["db"];
    acceptedAgentScopes: readonly string[];
  },
): Promise<RouteAuthResult> {
  const scopeError = input.scopes
    ? requireAnyScope(c, input.scopes)
    : input.scope
      ? requireScope(c, input.scope)
      : null;

  if (scopeError) {
    return { ok: false, response: scopeError };
  }

  const twinAuth = authorizeTwin(c);

  if (!twinAuth.ok) {
    return twinAuth;
  }

  const { auth, twinId } = twinAuth.value;

  if (!await hasActiveAgentGrantForScopes({
    db: input.db,
    auth,
    twinId,
    acceptedScopes: input.acceptedAgentScopes,
  })) {
    return { ok: false, response: c.json({ error: "agent_grant_inactive" }, 403) };
  }

  return twinAuth;
}

export async function authorizeTwinScopedJsonBody(
  c: Context<AuthEnv>,
  scope?: string,
  options?: { rejectArrays?: boolean },
): Promise<RouteGateResult<AuthorizedJsonBody>> {
  const routeAuth = authorizeTwinRoute(c, scope);

  if (!routeAuth.ok) {
    return routeAuth;
  }

  const parsedBody = await parseJsonObjectBody(c, options);

  if (!parsedBody.ok) {
    return parsedBody;
  }

  return {
    ok: true,
    value: {
      ...routeAuth.value,
      body: parsedBody.body,
    },
  };
}

export async function authorizeTwinScopedJsonBodyWithAgentGrant(
  c: Context<AuthEnv>,
  input: {
    scope?: string;
    scopes?: readonly string[];
    db: AppDependencies["db"];
    acceptedAgentScopes: readonly string[];
    rejectArrays?: boolean;
  },
): Promise<RouteGateResult<AuthorizedJsonBody>> {
  const routeAuth = await authorizeTwinRouteWithAgentGrant(c, input);

  if (!routeAuth.ok) {
    return routeAuth;
  }

  const parsedBody = await parseJsonObjectBody(c, {
    rejectArrays: input.rejectArrays,
  });

  if (!parsedBody.ok) {
    return parsedBody;
  }

  return {
    ok: true,
    value: {
      ...routeAuth.value,
      body: parsedBody.body,
    },
  };
}

export function twinScopedHandler(
  scope: string | undefined,
  handler: (c: Context<AuthEnv>, ctx: AuthorizedTwin) => Response | Promise<Response>,
) {
  return async (c: Context<AuthEnv>) => {
    const routeAuth = authorizeTwinRoute(c, scope);

    if (!routeAuth.ok) {
      return routeAuth.response;
    }

    return handler(c, routeAuth.value);
  };
}

export function twinScopedJsonHandler(
  scope: string | undefined,
  handler: (c: Context<AuthEnv>, ctx: AuthorizedJsonBody) => Response | Promise<Response>,
  options?: { rejectArrays?: boolean },
) {
  return async (c: Context<AuthEnv>) => {
    const gate = await authorizeTwinScopedJsonBody(c, scope, options);

    if (!gate.ok) {
      return gate.response;
    }

    return handler(c, gate.value);
  };
}

export async function authorizeTwinArtifactRoute(
  c: Context<AuthEnv>,
  db: AppDependencies["db"],
  scope?: string,
  options?: {
    paramName?: string;
    missingError?: string;
    notFoundError?: string;
  },
): Promise<RouteGateResult<AuthorizedArtifactRoute>> {
  const routeAuth = authorizeTwinRoute(c, scope);

  if (!routeAuth.ok) {
    return routeAuth;
  }

  const { twinId } = routeAuth.value;
  const artifactId = c.req.param(options?.paramName ?? "artifactId");

  if (!artifactId) {
    return {
      ok: false,
      response: c.json({ error: options?.missingError ?? "missing_artifact_id" }, 400),
    };
  }

  const artifact = await findSourceArtifact(db, twinId, artifactId);

  if (!artifact) {
    return {
      ok: false,
      response: c.json({ error: options?.notFoundError ?? "artifact_not_found" }, 404),
    };
  }

  return {
    ok: true,
    value: {
      ...routeAuth.value,
      artifact,
    },
  };
}

export async function authorizeWritebackIdRoute(
  c: Context<AuthEnv>,
  scope = "memory:read",
): Promise<RouteGateResult<AuthorizedWritebackRoute>> {
  const routeAuth = authorizeTwinRoute(c, scope);

  if (!routeAuth.ok) {
    return routeAuth;
  }

  const writebackId = readRouteUuid(c.req.param("writebackId"));

  if (!writebackId) {
    return { ok: false, response: c.json({ error: "invalid_writeback_id" }, 400) };
  }

  return {
    ok: true,
    value: {
      ...routeAuth.value,
      writebackId,
    },
  };
}

export async function loadAuthorizedWriteback(
  c: Context<AuthEnv>,
  db: AppDependencies["db"],
  scope = "memory:read",
): Promise<RouteGateResult<AuthorizedWritebackRoute & { writeback: typeof agentWritebacks.$inferSelect }>> {
  const gate = await authorizeWritebackIdRoute(c, scope);

  if (!gate.ok) {
    return gate;
  }

  const { twinId, writebackId } = gate.value;
  const [writeback] = await db
    .select()
    .from(agentWritebacks)
    .where(and(
      eq(agentWritebacks.id, writebackId),
      eq(agentWritebacks.twinId, twinId),
    ))
    .limit(1);

  if (!writeback) {
    return { ok: false, response: c.json({ error: "agent_writeback_not_found" }, 404) };
  }

  return {
    ok: true,
    value: {
      ...gate.value,
      writeback,
    },
  };
}

export async function authorizeEngineeringAgentRoute(
  c: Context<AuthEnv>,
  db: AppDependencies["db"],
  input: {
    scopes: readonly string[];
    acceptedAgentScopes: readonly string[];
  },
): Promise<RouteAuthResult> {
  return authorizeTwinRouteWithAgentGrant(c, {
    scopes: input.scopes,
    db,
    acceptedAgentScopes: input.acceptedAgentScopes,
  });
}

export function requireAgentClient(
  c: Context<AuthEnv>,
  auth: AuthClaims,
): Response | null {
  if (!auth.clientId) {
    return c.json({ error: "agent_client_required" }, 403);
  }

  return null;
}

function authorizeTwin(c: Context<AuthEnv>): RouteAuthResult {
  const auth = c.get("auth");
  const twinId = c.req.param("twinId");

  if (!twinId) {
    return { ok: false, response: c.json({ error: "missing_twin_id" }, 400) };
  }

  if (auth.type !== "service" && auth.twinId !== twinId) {
    return { ok: false, response: c.json({ error: "twin_scope_mismatch" }, 403) };
  }

  return {
    ok: true,
    value: {
      auth,
      twinId,
    },
  };
}

function readRouteUuid(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trimmed)
    ? trimmed
    : null;
}
