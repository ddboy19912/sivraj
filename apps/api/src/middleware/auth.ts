import type { AuthClaims } from "@sivraj/auth";
import { loadAuthConfig, parseBearerToken, verifySessionToken } from "@sivraj/auth";
import type { Context, MiddlewareHandler } from "hono";

export type AuthVariables = {
  auth: AuthClaims;
};

export type AuthEnv = {
  Variables: AuthVariables;
};

export const requireAuth: MiddlewareHandler<AuthEnv> = async (c, next) => {
  const token = parseBearerToken(c.req.header("authorization"));

  if (!token) {
    return c.json({ error: "missing_bearer_token" }, 401);
  }

  try {
    const auth = await verifySessionToken(token, loadAuthConfig(process.env));
    c.set("auth", auth);
    await next();
  } catch {
    return c.json({ error: "invalid_bearer_token" }, 401);
  }
};

export function requireScope(c: Context<AuthEnv>, scope: string): Response | null {
  const auth = c.get("auth");

  if (!auth.scopes.includes(scope)) {
    return c.json({ error: "missing_scope", scope }, 403);
  }

  return null;
}
