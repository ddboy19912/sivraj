import {
  accessPolicies,
  agentWritebacks,
  auditEvents,
  candidateMemories,
  connectorAccounts,
  connectorSources,
  connectorSyncItems,
  connectorSyncRuns,
  memoryFragments,
  permissionGrants,
  refreshSessions,
  sourceArtifacts,
  twins,
} from "@sivraj/db";
import { and, desc, eq, isNull, or } from "drizzle-orm";
import { Hono } from "hono";
import type { Context } from "hono";
import type { AppDependencies } from "../app.js";
import { sanitizeSafeMetadata } from "../lib/safe-metadata.js";
import { requireAuth, requireScope, type AuthEnv } from "../middleware/auth.js";

const SECURITY_EXPORT_NOTICE =
  "This export contains database metadata, references, hashes, status, and safe metadata only. It does not decrypt Seal/Walrus ciphertext or include raw private source text.";

export function createSecurityRoutes({ db }: AppDependencies) {
  const routes = new Hono<AuthEnv>();

  routes.get("/audit-events", requireAuth, async (c) => {
    const scopeError = requireScope(c, "memory:read");

    if (scopeError) {
      return scopeError;
    }

    const authError = authorizeTwin(c);

    if (authError) {
      return authError;
    }

    const twinId = c.req.param("twinId") ?? "";
    const requestedLimit = Number.parseInt(c.req.query("limit") ?? "50", 10);
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(Math.max(requestedLimit, 1), 200)
      : 50;
    const eventType = c.req.query("eventType");
    const whereClause = eventType
      ? and(eq(auditEvents.twinId, twinId), eq(auditEvents.eventType, eventType))
      : eq(auditEvents.twinId, twinId);

    const events = await db
      .select()
      .from(auditEvents)
      .where(whereClause)
      .orderBy(desc(auditEvents.createdAt))
      .limit(limit);

    await recordSecurityAudit(c, db, "security.audit_log_read", "audit_events", twinId, {
      limit,
      eventType: eventType ?? null,
    });

    return c.json({
      auditEvents: events.map((event) => ({
        ...event,
        metadata: sanitizeSafeMetadata(event.metadata),
      })),
    });
  });

  routes.post("/revoke-access", requireAuth, async (c) => {
    const scopeError = requireScope(c, "artifact:upload");

    if (scopeError) {
      return scopeError;
    }

    const authError = authorizeTwin(c);

    if (authError) {
      return authError;
    }

    const twinId = c.req.param("twinId") ?? "";
    const now = new Date();

    await Promise.all([
      db
        .update(permissionGrants)
        .set({ revokedAt: now, updatedAt: now })
        .where(and(eq(permissionGrants.twinId, twinId), isNull(permissionGrants.revokedAt))),
      db
        .update(refreshSessions)
        .set({ revokedAt: now, updatedAt: now })
        .where(and(eq(refreshSessions.twinId, twinId), isNull(refreshSessions.revokedAt))),
      db
        .update(connectorAccounts)
        .set({
          status: "disconnected",
          tokenRef: null,
          nextSyncAt: null,
          updatedAt: now,
        })
        .where(eq(connectorAccounts.twinId, twinId)),
      db
        .update(connectorSources)
        .set({
          status: "disconnected",
          nextSyncAt: null,
          updatedAt: now,
        })
        .where(eq(connectorSources.twinId, twinId)),
      db
        .update(connectorSyncRuns)
        .set({
          status: "cancelled",
          completedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(connectorSyncRuns.twinId, twinId),
            or(eq(connectorSyncRuns.status, "queued"), eq(connectorSyncRuns.status, "processing")),
          ),
        ),
      db
        .update(accessPolicies)
        .set({ expiresAt: now, updatedAt: now })
        .where(eq(accessPolicies.twinId, twinId)),
    ]);

    await recordSecurityAudit(c, db, "security.access_revoked", "twin", twinId, {
      revokedAt: now.toISOString(),
      revokedScopes: [
        "permission_grants",
        "refresh_sessions",
        "connector_accounts",
        "connector_sources",
        "connector_sync_runs",
        "access_policies",
      ],
    });

    return c.json({
      status: "revoked",
      twinId,
      revokedAt: now.toISOString(),
      revokedScopes: [
        "permission_grants",
        "refresh_sessions",
        "connector_accounts",
        "connector_sources",
        "connector_sync_runs",
        "access_policies",
      ],
    });
  });

  routes.get("/export", requireAuth, async (c) => {
    const scopeError = requireScope(c, "memory:read");

    if (scopeError) {
      return scopeError;
    }

    const authError = authorizeTwin(c);

    if (authError) {
      return authError;
    }

    const twinId = c.req.param("twinId") ?? "";
    const [
      artifacts,
      fragments,
      candidates,
      accounts,
      sources,
      syncRuns,
      syncItems,
      grants,
      policies,
      writebacks,
      events,
    ] = await Promise.all([
      rowsForTwin(db, sourceArtifacts, twinId),
      rowsForTwin(db, memoryFragments, twinId),
      rowsForTwin(db, candidateMemories, twinId),
      rowsForTwin(db, connectorAccounts, twinId),
      rowsForTwin(db, connectorSources, twinId),
      rowsForTwin(db, connectorSyncRuns, twinId),
      rowsForTwin(db, connectorSyncItems, twinId),
      rowsForTwin(db, permissionGrants, twinId),
      rowsForTwin(db, accessPolicies, twinId),
      rowsForTwin(db, agentWritebacks, twinId),
      rowsForTwin(db, auditEvents, twinId, 200),
    ]);

    await recordSecurityAudit(c, db, "security.data_exported", "twin", twinId, {
      exportKind: "safe_metadata",
    });

    return c.json({
      exportedAt: new Date().toISOString(),
      twinId,
      exportKind: "safe_metadata",
      notice: SECURITY_EXPORT_NOTICE,
      sourceArtifacts: artifacts.map(redactMetadata),
      memoryFragments: fragments.map(redactMetadata),
      candidateMemories: candidates.map(redactMetadata),
      connectors: {
        accounts: accounts.map(redactConnectorAccount),
        sources: sources.map(redactMetadata),
        syncRuns: syncRuns.map(redactMetadata),
        syncItems: syncItems.map(redactMetadata),
      },
      permissionGrants: grants,
      accessPolicies: policies,
      agentWritebacks: writebacks.map(redactAgentWriteback),
      auditEvents: events.map(redactMetadata),
    });
  });

  routes.delete("/data", requireAuth, async (c) => {
    const scopeError = requireScope(c, "artifact:upload");

    if (scopeError) {
      return scopeError;
    }

    const authError = authorizeTwin(c);

    if (authError) {
      return authError;
    }

    const twinId = c.req.param("twinId") ?? "";
    const existing = await db
      .select()
      .from(twins)
      .where(eq(twins.id, twinId))
      .limit(1);

    if (existing.length === 0) {
      return c.json({ error: "twin_not_found" }, 404);
    }

    const requestedAt = new Date();

    await db
      .update(refreshSessions)
      .set({ revokedAt: requestedAt, updatedAt: requestedAt })
      .where(and(eq(refreshSessions.twinId, twinId), isNull(refreshSessions.revokedAt)));

    await recordSecurityAudit(c, db, "security.data_deletion_requested", "twin", twinId, {
      requestedAt: requestedAt.toISOString(),
      deletionBoundary: "postgres_cascade_with_cryptographic_revocation",
    });

    await db.delete(twins).where(eq(twins.id, twinId));

    return c.json({
      status: "deleted",
      twinId,
      deletedAt: new Date().toISOString(),
      deletionBoundary: "postgres_cascade_with_cryptographic_revocation",
      walrusNote:
        "Walrus ciphertext may remain durable; Sivraj deletes local metadata and removes future cryptographic access.",
    });
  });

  return routes;
}

function authorizeTwin(c: Context<AuthEnv>): Response | null {
  const auth = c.get("auth");
  const twinId = c.req.param("twinId");

  if (auth.type === "service") {
    return null;
  }

  if (auth.twinId !== twinId) {
    return c.json({ error: "twin_scope_mismatch" }, 403);
  }

  return null;
}

async function rowsForTwin(
  db: AppDependencies["db"],
  table: any,
  twinId: string,
  limit = 500,
) {
  const query = db
    .select()
    .from(table)
    .where(eq(table.twinId, twinId));

  if (table.createdAt) {
    return query.orderBy(desc(table.createdAt)).limit(limit);
  }

  return query.limit(limit);
}

async function recordSecurityAudit(
  c: Context<AuthEnv>,
  db: AppDependencies["db"],
  eventType: string,
  resourceType: string,
  resourceId: string,
  metadata: Record<string, unknown>,
) {
  const auth = c.get("auth");

  await db.insert(auditEvents).values({
    twinId: c.req.param("twinId") ?? "",
    actorType: auth.type,
    actorId: auth.sub,
    eventType,
    resourceType,
    resourceId,
    metadata,
  });
}

function redactMetadata<T extends { metadata?: unknown }>(row: T) {
  return {
    ...row,
    metadata: sanitizeSafeMetadata(row.metadata),
  };
}

function redactConnectorAccount<T extends { metadata?: unknown; tokenRef?: unknown }>(
  row: T,
) {
  return {
    ...redactMetadata(row),
    tokenRef: row.tokenRef ? "redacted" : null,
  };
}

function redactAgentWriteback<T extends { payload?: unknown }>(row: T) {
  const record = row as Record<string, unknown>;
  const payload = row.payload && typeof row.payload === "object"
    ? (row.payload as Record<string, unknown>)
    : {};

  return {
    ...row,
    payload: {
      kind: payload["kind"] ?? null,
      status: record["status"] ?? null,
      counts: payload["counts"] ?? null,
      storage: sanitizeSafeMetadata(payload["storage"]),
    },
  };
}
