import { Hono } from "hono";
import type { AppDependencies } from "../app.js";
import { requireAuth, type AuthEnv } from "../middleware/auth.js";
import { authorizeTwinRoute } from "../lib/http/route-auth.js";
import {
  handleSecurityAuditEventsGet,
  handleSecurityDeleteData,
  handleSecurityExportGet,
  handleSecurityRevokeAccessPost,
} from "./security-handlers.js";

export function createSecurityRoutes({ db }: AppDependencies) {
  const routes = new Hono<AuthEnv>();

  routes.get("/audit-events", requireAuth, async (c) => {
    const routeAuth = authorizeTwinRoute(c, "memory:read");
    if (!routeAuth.ok) {
      return routeAuth.response;
    }

    return handleSecurityAuditEventsGet(c, db, routeAuth.value.twinId);
  });

  routes.post("/revoke-access", requireAuth, async (c) => {
    const routeAuth = authorizeTwinRoute(c, "artifact:upload");
    if (!routeAuth.ok) {
      return routeAuth.response;
    }

    return handleSecurityRevokeAccessPost(c, db, routeAuth.value.twinId);
  });

  routes.get("/export", requireAuth, async (c) => {
    const routeAuth = authorizeTwinRoute(c, "memory:read");
    if (!routeAuth.ok) {
      return routeAuth.response;
    }

    return handleSecurityExportGet(c, db, routeAuth.value.twinId);
  });

  routes.delete("/data", requireAuth, async (c) => {
    const routeAuth = authorizeTwinRoute(c, "artifact:upload");
    if (!routeAuth.ok) {
      return routeAuth.response;
    }

    return handleSecurityDeleteData(c, db, routeAuth.value.twinId);
  });

  return routes;
}
