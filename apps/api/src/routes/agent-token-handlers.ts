import { apiClients, auditEvents, permissionGrants } from "@sivraj/db";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import type { Context } from "hono";
import type { AppDependencies } from "../app.js";
import type { AuthEnv } from "../middleware/auth.js";
import { authorizeTwinRoute, type AuthorizedTwin } from "../lib/http/route-auth.js";
import { optionalString } from "../lib/http/route-helpers.js";
import {
  clampTtl,
  readAgentScopes,
  readAuthConfig,
  readGrantStatus,
  readUuid,
  sanitizeAgentClientMetadata,
} from "../lib/agent-tokens/helpers.js";
import {
  AGENT_CONTEXT_READ_SCOPE,
  AGENT_MEMORY_SEARCH_SCOPE,
  AGENT_PROJECT_PROFILE_READ_SCOPE,
  AGENT_SOURCE_READ_SCOPE,
  AGENT_WRITEBACK_CREATE_SCOPE,
  signSessionToken,
  type AgentScope,
} from "@sivraj/auth";

const DEFAULT_AGENT_SCOPES: AgentScope[] = [
  AGENT_CONTEXT_READ_SCOPE,
  AGENT_SOURCE_READ_SCOPE,
  AGENT_PROJECT_PROFILE_READ_SCOPE,
  AGENT_MEMORY_SEARCH_SCOPE,
  AGENT_WRITEBACK_CREATE_SCOPE,
];

export async function handleCreateAgentToken(
  c: Context<AuthEnv>,
  db: AppDependencies["db"],
  { auth, twinId }: AuthorizedTwin,
) {
  if (auth.type !== "user" && auth.type !== "service") {
    return c.json({ error: "agent_tokens_require_user_or_service_actor" }, 403);
  }

  const body = await c.req.json().catch(() => ({}));
  const agentName = optionalString(body["agentName"]) ?? "Coding Agent";
  const scopes = resolveAgentTokenScopes(body["scopes"]);
  const expiresInMinutes = clampTtl(body["expiresInMinutes"]);
  const authConfig = readAuthConfig();

  if (!authConfig) {
    return c.json({ error: "auth_not_configured" }, 503);
  }

  const { client, grant, expiresAt } = await insertAgentClientWithGrant(db, {
    twinId,
    auth,
    agentName,
    scopes,
    expiresInMinutes,
    userAgent: c.req.header("user-agent") ?? null,
  });
  const token = await signSessionToken(
    {
      sub: client.id,
      type: "agent",
      scopes,
      twinId,
      clientId: client.id,
    },
    authConfig,
    `${expiresInMinutes}m`,
  );

  await db.insert(auditEvents).values({
    twinId,
    actorType: auth.type,
    actorId: auth.sub,
    eventType: "agent_token.created",
    resourceType: "api_client",
    resourceId: client.id,
    metadata: {
      clientId: client.id,
      grantId: grant.id,
      agentName,
      scopes,
      expiresAt: expiresAt.toISOString(),
    },
  });

  return c.json(
    {
      token,
      tokenType: "Bearer",
      subjectType: "agent",
      clientId: client.id,
      grantId: grant.id,
      twinId,
      scopes,
      expiresAt: expiresAt.toISOString(),
    },
    201,
  );
}

async function insertAgentClientWithGrant(
  db: AppDependencies["db"],
  input: {
    twinId: string;
    auth: AuthorizedTwin["auth"];
    agentName: string;
    scopes: AgentScope[];
    expiresInMinutes: number;
    userAgent: string | null;
  },
) {
  const expiresAt = new Date(Date.now() + input.expiresInMinutes * 60 * 1000);
  const [client] = await db
    .insert(apiClients)
    .values({
      name: input.agentName,
      type: "coding_agent",
      metadata: {
        createdBy: input.auth.sub,
        createdByType: input.auth.type,
        origin: "agent_token_flow",
        userAgent: input.userAgent,
      },
    })
    .returning();
  const [grant] = await db
    .insert(permissionGrants)
    .values({
      twinId: input.twinId,
      clientId: client.id,
      scopes: input.scopes,
      memoryDomains: ["engineering"],
      expiresAt,
    })
    .returning();

  return { client, grant, expiresAt };
}

function resolveAgentTokenScopes(value: unknown): AgentScope[] {
  const requestedScopes = readAgentScopes(value);
  return requestedScopes.length > 0 ? requestedScopes : DEFAULT_AGENT_SCOPES;
}

export async function handleListAgentClients(
  c: Context<AuthEnv>,
  db: AppDependencies["db"],
  { auth, twinId }: AuthorizedTwin,
) {
  const grants = await db
    .select()
    .from(permissionGrants)
    .where(eq(permissionGrants.twinId, twinId))
    .orderBy(desc(permissionGrants.createdAt))
    .limit(100);
  const clientIds = Array.from(new Set(grants.map((grant) => grant.clientId)));
  const clients = clientIds.length > 0
    ? await db.select().from(apiClients).where(inArray(apiClients.id, clientIds))
    : [];
  const clientsById = new Map(clients.map((client) => [client.id, client]));

  await db.insert(auditEvents).values({
    twinId,
    actorType: auth.type,
    actorId: auth.sub,
    eventType: "agent_clients.listed",
    resourceType: "twin",
    resourceId: twinId,
    metadata: {
      clientCount: clients.length,
      grantCount: grants.length,
    },
  });

  return c.json({
    policy: {
      rawArtifactsIncluded: false,
      scope: "memory:read",
    },
    clients: grants.map((grant) => formatAgentClientGrant(grant, clientsById.get(grant.clientId))),
  });
}

export async function handleRevokeAgentClient(
  c: Context<AuthEnv>,
  db: AppDependencies["db"],
  { auth, twinId }: AuthorizedTwin,
) {
  const grantOrClientId = readUuid(c.req.param("grantId"));

  if (!grantOrClientId) {
    return c.json({ error: "invalid_grant_or_client_id" }, 400);
  }

  const now = new Date();
  const [grant] = await db
    .update(permissionGrants)
    .set({
      revokedAt: now,
      updatedAt: now,
    })
    .where(and(
      eq(permissionGrants.twinId, twinId),
      or(
        eq(permissionGrants.id, grantOrClientId),
        eq(permissionGrants.clientId, grantOrClientId),
      ),
    ))
    .returning();

  if (!grant) {
    return c.json({ error: "agent_grant_not_found" }, 404);
  }

  await db.insert(auditEvents).values({
    twinId,
    actorType: auth.type,
    actorId: auth.sub,
    eventType: "agent_client.revoked",
    resourceType: "permission_grant",
    resourceId: grant.id,
    metadata: {
      clientId: grant.clientId,
      scopes: grant.scopes,
    },
  });

  return c.json({
    grantId: grant.id,
    clientId: grant.clientId,
    revokedAt: now.toISOString(),
    status: "revoked",
  });
}

function formatAgentClientGrant(
  grant: typeof permissionGrants.$inferSelect,
  client: typeof apiClients.$inferSelect | undefined,
) {
  return {
    clientId: grant.clientId,
    grantId: grant.id,
    name: client?.name ?? "Unknown agent",
    type: client?.type ?? "unknown",
    scopes: grant.scopes,
    memoryDomains: grant.memoryDomains,
    expiresAt: grant.expiresAt?.toISOString() ?? null,
    revokedAt: grant.revokedAt?.toISOString() ?? null,
    createdAt: grant.createdAt.toISOString(),
    updatedAt: grant.updatedAt.toISOString(),
    status: readGrantStatus(grant.revokedAt, grant.expiresAt),
    metadata: sanitizeAgentClientMetadata(client?.metadata),
  };
}
