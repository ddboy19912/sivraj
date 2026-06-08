import { Hono } from "hono";
import type { AppDependencies } from "../app.js";
import { requireAuth, requireScope, type AuthEnv } from "../middleware/auth.js";
import {
  authorizeTwinRoute,
  twinScopedHandler,
  twinScopedJsonHandler,
} from "../lib/http/route-auth.js";
import { optionalString } from "../lib/http/route-helpers.js";
import { handleConnectorAccountSync } from "./connector-account-sync.js";
import { readSyncMode, recordValue } from "../lib/connectors/helpers.js";
import {
  handleConnectorsAvailableGet,
  handleConnectorsListGet,
  handleConnectorSyncRunGet,
  handleCreateConnectorAccount,
  handlePatchConnectorAccount,
} from "./connector-handlers.js";

export function createConnectorRoutes({
  db,
  connectorSyncQueue,
}: AppDependencies) {
  const routes = new Hono<AuthEnv>();

  routes.get("/available", requireAuth, (c) => {
    const scopeError = requireScope(c, "artifact:read");
    if (scopeError) {
      return scopeError;
    }

    return handleConnectorsAvailableGet(c);
  });

  routes.get("/", requireAuth, async (c) => {
    const routeAuth = authorizeTwinRoute(c, "artifact:read");
    if (!routeAuth.ok) {
      return routeAuth.response;
    }

    return handleConnectorsListGet(c, db, routeAuth.value.twinId);
  });

  routes.post("/accounts", requireAuth, twinScopedJsonHandler("artifact:upload", (c, ctx) =>
    handleCreateConnectorAccount(c, db, ctx),
  { rejectArrays: false }));

  routes.post("/accounts/:accountId/sync", requireAuth, twinScopedHandler("artifact:upload", async (c, ctx) => {
    const body = await c.req.json().catch(() => ({}));

    return handleConnectorAccountSync(c, {
      db,
      connectorSyncQueue,
      ...ctx,
      accountId: c.req.param("accountId") ?? "",
      mode: readSyncMode(recordValue(body, "mode")) ?? "manual",
      connectorSourceId: optionalString(recordValue(body, "connectorSourceId")),
    });
  }));

  routes.get("/sync-runs/:syncRunId", requireAuth, async (c) => {
    const routeAuth = authorizeTwinRoute(c, "artifact:read");
    if (!routeAuth.ok) {
      return routeAuth.response;
    }

    return handleConnectorSyncRunGet(c, db, routeAuth.value.twinId, c.req.param("syncRunId") ?? "");
  });

  routes.patch("/accounts/:accountId", requireAuth, twinScopedJsonHandler("artifact:upload", (c, ctx) =>
    handlePatchConnectorAccount(c, db, ctx, c.req.param("accountId") ?? ""),
  { rejectArrays: false }));

  return routes;
}
