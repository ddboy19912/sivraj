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
import type { Context } from "hono";
import type { AppDependencies } from "../app.js";
import type { AuthEnv } from "../middleware/auth.js";
import {
  redactAgentWriteback,
  redactConnectorAccount,
  redactMetadata,
  recordSecurityAudit,
  rowsForTwin,
  SECURITY_EXPORT_NOTICE,
} from "../lib/security/helpers.js";

export async function handleSecurityAuditEventsGet(
  c: Context<AuthEnv>,
  db: AppDependencies["db"],
  twinId: string,
) {
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
      metadata: redactMetadata(event).metadata,
    })),
  });
}

export async function handleSecurityRevokeAccessPost(
  c: Context<AuthEnv>,
  db: AppDependencies["db"],
  twinId: string,
) {
  const now = new Date();

  await Promise.all(revokeTwinAccessUpdates(db, twinId, now));

  const revokedScopes = [
    "permission_grants",
    "refresh_sessions",
    "connector_accounts",
    "connector_sources",
    "connector_sync_runs",
    "access_policies",
  ];

  await recordSecurityAudit(c, db, "security.access_revoked", "twin", twinId, {
    revokedAt: now.toISOString(),
    revokedScopes,
  });

  return c.json({
    status: "revoked",
    twinId,
    revokedAt: now.toISOString(),
    revokedScopes,
  });
}

export async function handleSecurityExportGet(
  c: Context<AuthEnv>,
  db: AppDependencies["db"],
  twinId: string,
) {
  const exportBundle = await loadSecurityExportBundle(db, twinId);

  await recordSecurityAudit(c, db, "security.data_exported", "twin", twinId, {
    exportKind: "safe_metadata",
  });

  return c.json({
    exportedAt: new Date().toISOString(),
    twinId,
    exportKind: "safe_metadata",
    notice: SECURITY_EXPORT_NOTICE,
    ...exportBundle,
  });
}

export async function handleSecurityDeleteData(
  c: Context<AuthEnv>,
  db: AppDependencies["db"],
  twinId: string,
) {
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
}

async function loadSecurityExportBundle(db: AppDependencies["db"], twinId: string) {
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

  return {
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
  };
}

function revokeTwinAccessUpdates(
  db: AppDependencies["db"],
  twinId: string,
  now: Date,
) {
  return [
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
  ];
}
