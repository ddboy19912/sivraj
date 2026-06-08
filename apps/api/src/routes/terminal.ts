import { Hono } from "hono";
import type { AppDependencies } from "../app.js";
import { requireAuth, type AuthEnv } from "../middleware/auth.js";
import { handleTerminalCommandPost } from "./terminal-handlers.js";

export function createTerminalRoutes(dependencies: AppDependencies) {
  const routes = new Hono<AuthEnv>();

  routes.post("/commands", requireAuth, (c) =>
    handleTerminalCommandPost(c, dependencies),
  );

  return routes;
}
