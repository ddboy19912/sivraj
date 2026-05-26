import { permissionGrants } from "@sivraj/db";
import type { AuthClaims } from "@sivraj/auth";
import { and, eq, gt, isNull, or } from "drizzle-orm";
import type { ApiDb } from "../app.js";

export async function hasActiveAgentGrant(input: {
  db: ApiDb;
  auth: AuthClaims;
  twinId: string;
}): Promise<boolean> {
  return hasActiveAgentGrantForScopes(input);
}

export async function hasActiveAgentGrantForScopes(input: {
  db: ApiDb;
  auth: AuthClaims;
  twinId: string;
  acceptedScopes?: readonly string[];
}): Promise<boolean> {
  if (input.auth.type !== "agent") {
    return true;
  }

  if (!input.auth.clientId) {
    return false;
  }

  const [grant] = await input.db
    .select({ id: permissionGrants.id, scopes: permissionGrants.scopes })
    .from(permissionGrants)
    .where(and(
      eq(permissionGrants.twinId, input.twinId),
      eq(permissionGrants.clientId, input.auth.clientId),
      isNull(permissionGrants.revokedAt),
      or(
        isNull(permissionGrants.expiresAt),
        gt(permissionGrants.expiresAt, new Date()),
      ),
    ))
    .limit(1);

  if (!grant) {
    return false;
  }

  const acceptedScopes = input.acceptedScopes ?? [];
  if (acceptedScopes.length === 0) {
    return true;
  }

  const grantScopes = Array.isArray(grant.scopes) ? grant.scopes : [];

  return grantScopes.some((scope) => acceptedScopes.includes(scope));
}
