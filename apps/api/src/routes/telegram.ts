import { Hono } from "hono";
import type { AppDependencies } from "../app.js";
import { requireAuth, type AuthEnv } from "../middleware/auth.js";
import {
  authorizeTwinRouteWithAnyScope,
  twinScopedHandler,
} from "../lib/http/route-auth.js";
import {
  handleTelegramConnectionGet,
  handleTelegramLinkTokenCreate,
  handleTelegramRevoke,
  handleTelegramWebhook,
} from "./telegram-handlers.js";

export function createTelegramRoutes(deps: AppDependencies) {
  const routes = new Hono<AuthEnv>();

  routes.post("/webhook", (c) => handleTelegramWebhook(c, deps));

  routes.get("/", requireAuth, async (c) => {
    const routeAuth = authorizeTwinRouteWithAnyScope(c, [
      "artifact:read",
      "artifact:upload",
    ]);

    if (!routeAuth.ok) {
      return routeAuth.response;
    }

    return handleTelegramConnectionGet(c, deps, routeAuth.value);
  });

  routes.post("/link-token", requireAuth, twinScopedHandler("artifact:upload", (c, ctx) =>
    handleTelegramLinkTokenCreate(c, deps, ctx),
  ));

  routes.post("/revoke", requireAuth, twinScopedHandler("artifact:upload", (c, ctx) =>
    handleTelegramRevoke(c, deps, ctx),
  ));

  return routes;
}
