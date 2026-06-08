import { AGENT_WRITEBACK_CREATE_SCOPE } from "@sivraj/auth";
import { Hono } from "hono";
import type { Context } from "hono";
import type { AppDependencies } from "../app.js";
import { requireAuth, type AuthEnv } from "../middleware/auth.js";
import {
  authorizeTwinRoute,
  authorizeTwinScopedJsonBodyWithAgentGrant,
  authorizeWritebackIdRoute,
  loadAuthorizedWriteback,
  twinScopedHandler,
  type AuthorizedTwin,
} from "../lib/http/route-auth.js";
import {
  handleCreateAgentToken,
  handleListAgentClients,
  handleRevokeAgentClient,
} from "./agent-token-handlers.js";
import {
  createPrOrCommitWritebackImport,
  handleApproveAgentWriteback,
  handleCreateAgentWriteback,
  handleListAgentWritebacks,
  handleRejectAgentWriteback,
} from "./agent-writeback-handlers.js";

export function createAgentTokenRoutes(deps: AppDependencies) {
  const routes = new Hono<AuthEnv>();
  registerAgentTokenRoutes(routes, deps);
  return routes;
}

function registerAgentTokenRoutes(routes: Hono<AuthEnv>, deps: AppDependencies) {
  const { db, privateMemoryStorage, artifactProcessingQueue, transientCiphertextCache } = deps;

  routes.post("/tokens", requireAuth, (c) => authorizeAndCall(c, db, handleCreateAgentToken));
  routes.get("/clients", requireAuth, (c) => authorizeAndCall(c, db, handleListAgentClients));
  routes.post("/clients/:grantId/revoke", requireAuth, (c) => authorizeAndCall(c, db, handleRevokeAgentClient));

  routes.post("/writebacks", requireAuth, (c) => createWriteback(c, deps));
  routes.post("/writebacks/imports/pr", requireAuth, (c) => importWriteback(c, deps, "pull_request"));
  routes.post("/writebacks/imports/commit", requireAuth, (c) => importWriteback(c, deps, "commit"));
  routes.get("/writebacks", requireAuth, (c) => authorizeAndCall(c, db, handleListAgentWritebacks));
  routes.post("/writebacks/:writebackId/approve", requireAuth, (c) => approveWriteback(c, deps));
  routes.post("/writebacks/:writebackId/reject", requireAuth, twinScopedHandler("memory:read", (c, ctx) =>
    rejectWriteback(c, db, ctx),
  ));
}

async function authorizeAndCall(
  c: Context<AuthEnv>,
  db: AppDependencies["db"],
  handler: (
    c: Context<AuthEnv>,
    db: AppDependencies["db"],
    ctx: AuthorizedTwin,
  ) => Response | Promise<Response>,
) {
  const routeAuth = authorizeTwinRoute(c, "memory:read");
  if (!routeAuth.ok) {
    return routeAuth.response;
  }

  return handler(c, db, routeAuth.value);
}

async function createWriteback(c: Parameters<typeof handleCreateAgentWriteback>[0], deps: AppDependencies) {
  const gate = await authorizeTwinScopedJsonBodyWithAgentGrant(c, {
    scopes: [AGENT_WRITEBACK_CREATE_SCOPE, "artifact:upload"],
    db: deps.db,
    acceptedAgentScopes: [AGENT_WRITEBACK_CREATE_SCOPE],
    rejectArrays: false,
  });

  if (!gate.ok) {
    return gate.response;
  }

  return handleCreateAgentWriteback(c, {
    db: deps.db,
    privateMemoryStorage: deps.privateMemoryStorage,
    transientCiphertextCache: deps.transientCiphertextCache,
    ...gate.value,
  });
}

async function importWriteback(
  c: Parameters<typeof createPrOrCommitWritebackImport>[0],
  deps: AppDependencies,
  kind: "pull_request" | "commit",
) {
  return createPrOrCommitWritebackImport(c, {
    db: deps.db,
    privateMemoryStorage: deps.privateMemoryStorage,
    transientCiphertextCache: deps.transientCiphertextCache,
    kind,
  });
}

async function approveWriteback(c: Parameters<typeof handleApproveAgentWriteback>[0], deps: AppDependencies) {
  const gate = await loadAuthorizedWriteback(c, deps.db);

  if (!gate.ok) {
    return gate.response;
  }

  return handleApproveAgentWriteback(c, {
    db: deps.db,
    artifactProcessingQueue: deps.artifactProcessingQueue,
    transientCiphertextCache: deps.transientCiphertextCache,
    ...gate.value,
  });
}

async function rejectWriteback(
  c: Parameters<typeof handleRejectAgentWriteback>[0],
  db: AppDependencies["db"],
  ctx: { auth: Parameters<typeof handleRejectAgentWriteback>[2]["auth"]; twinId: string },
) {
  const writebackGate = await authorizeWritebackIdRoute(c);

  if (!writebackGate.ok) {
    return writebackGate.response;
  }

  return handleRejectAgentWriteback(c, db, {
    auth: ctx.auth,
    twinId: ctx.twinId,
    writebackId: writebackGate.value.writebackId,
  });
}
