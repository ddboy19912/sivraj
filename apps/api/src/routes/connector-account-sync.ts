import {
  auditEvents,
  connectorAccounts,
  connectorSources,
  connectorSyncRuns,
} from "@sivraj/db";
import { and, eq } from "drizzle-orm";
import type { Context } from "hono";
import type { AppDependencies } from "../app.js";
import type { AuthEnv } from "../middleware/auth.js";
import type { AuthorizedTwin } from "../lib/http/route-auth.js";

type ConnectorAccountRow = typeof connectorAccounts.$inferSelect;
type ConnectorSourceRow = typeof connectorSources.$inferSelect;
type ConnectorMode = typeof connectorSyncRuns.$inferSelect["mode"];
type ConnectorProvider = typeof connectorSyncRuns.$inferSelect["provider"];
type ConnectorSyncErrorStatus = 404 | 409;

export function readConnectorSyncErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown queue error";
}

export function buildConnectorSyncQueueWarning(input: {
  connectorSyncQueueConfigured: boolean;
  queued: { jobId: string } | null;
}) {
  if (!input.connectorSyncQueueConfigured) {
    return "connector_sync_queue_not_configured";
  }

  return input.queued ? null : "connector_sync_queue_failed";
}

export function buildConnectorSyncResponseBody(input: {
  syncRun: { id: string };
  queued: { jobId: string } | null;
  connectorSyncQueueConfigured: boolean;
}) {
  return {
    syncRun: input.syncRun,
    jobId: input.queued?.jobId ?? null,
    warning: buildConnectorSyncQueueWarning({
      connectorSyncQueueConfigured: input.connectorSyncQueueConfigured,
      queued: input.queued,
    }),
  };
}

function readConnectorSyncAuditMetadata(input: {
  provider: ConnectorProvider;
  connectorAccountId: string;
  connectorSourceId: string | null;
  mode: ConnectorMode;
}) {
  return {
    provider: input.provider,
    connectorAccountId: input.connectorAccountId,
    connectorSourceId: input.connectorSourceId,
    mode: input.mode,
  };
}

export function buildConnectorSyncRunValues(input: {
  twinId: string;
  account: Pick<ConnectorAccountRow, "id" | "provider" | "cursor">;
  source: Pick<ConnectorSourceRow, "id" | "cursor"> | null;
  mode: ConnectorMode;
  requestedBy: string;
}) {
  return {
    twinId: input.twinId,
    connectorAccountId: input.account.id,
    connectorSourceId: input.source?.id ?? null,
    provider: input.account.provider,
    mode: input.mode,
    status: "queued" as const,
    cursorBefore: input.source?.cursor ?? input.account.cursor,
    metadata: {
      requestedBy: input.requestedBy,
      provider: input.account.provider,
    },
  };
}

export function buildConnectorSyncEnqueueInput(input: {
  syncRunId: string;
  twinId: string;
  account: Pick<ConnectorAccountRow, "id" | "provider">;
  source: Pick<ConnectorSourceRow, "id"> | null;
  mode: ConnectorMode;
}) {
  return {
    syncRunId: input.syncRunId,
    twinId: input.twinId,
    connectorAccountId: input.account.id,
    connectorSourceId: input.source?.id ?? null,
    provider: input.account.provider,
    mode: input.mode,
  };
}

export function readConnectorSyncSourceError<T extends {
  ok: boolean;
  error?: { status: ConnectorSyncErrorStatus; body: unknown };
}>(
  source: T | null,
) {
  return source && !source.ok ? source.error : null;
}

export function buildConnectorSyncQueueFailureAudit(input: {
  twinId: string;
  syncRunId: string;
  error: string;
}) {
  return {
    twinId: input.twinId,
    actorType: "system" as const,
    actorId: "sivraj-api",
    eventType: "connector.sync_queue_failed",
    resourceType: "connector_sync_run",
    resourceId: input.syncRunId,
    metadata: { error: input.error },
  };
}

export async function loadConnectorAccountForSync(
  db: AppDependencies["db"],
  twinId: string,
  accountId: string,
) {
  const [account] = await db
    .select()
    .from(connectorAccounts)
    .where(
      and(
        eq(connectorAccounts.id, accountId),
        eq(connectorAccounts.twinId, twinId),
      ),
    )
    .limit(1);

  if (!account) {
    return {
      ok: false as const,
      error: { status: 404 as const, body: { error: "connector_account_not_found" } },
    };
  }

  if (account.status !== "connected") {
    return {
      ok: false as const,
      error: {
        status: 409 as const,
        body: { error: "connector_account_not_syncable", status: account.status },
      },
    };
  }

  return { ok: true as const, value: account };
}

export async function loadConnectorSourceForSync(
  db: AppDependencies["db"],
  input: { twinId: string; accountId: string; connectorSourceId: string },
) {
  const [source] = await db
    .select()
    .from(connectorSources)
    .where(
      and(
        eq(connectorSources.id, input.connectorSourceId),
        eq(connectorSources.twinId, input.twinId),
        eq(connectorSources.connectorAccountId, input.accountId),
      ),
    )
    .limit(1);

  if (!source) {
    return {
      ok: false as const,
      error: { status: 404 as const, body: { error: "connector_source_not_found" } },
    };
  }

  return { ok: true as const, value: source };
}

export async function enqueueConnectorSyncJob(input: {
  db: AppDependencies["db"];
  connectorSyncQueue: NonNullable<AppDependencies["connectorSyncQueue"]>;
  twinId: string;
  syncRunId: string;
  enqueueInput: ReturnType<typeof buildConnectorSyncEnqueueInput>;
}) {
  return input.connectorSyncQueue
    .enqueueConnectorSync(input.enqueueInput)
    .catch(async (error: unknown) => {
      await input.db.insert(auditEvents).values(
        buildConnectorSyncQueueFailureAudit({
          twinId: input.twinId,
          syncRunId: input.syncRunId,
          error: readConnectorSyncErrorMessage(error),
        }),
      );
      return null;
    });
}

export async function handleConnectorAccountSync(
  c: Context<AuthEnv>,
  input: {
    db: AppDependencies["db"];
    connectorSyncQueue: AppDependencies["connectorSyncQueue"];
    auth: AuthorizedTwin["auth"];
    twinId: string;
    accountId: string;
    mode: ConnectorMode;
    connectorSourceId: string | null;
  },
) {
  const account = await loadConnectorAccountForSync(input.db, input.twinId, input.accountId);

  if (!account.ok) {
    return c.json(account.error.body, account.error.status);
  }

  const source = input.connectorSourceId
    ? await loadConnectorSourceForSync(input.db, {
        twinId: input.twinId,
        accountId: input.accountId,
        connectorSourceId: input.connectorSourceId,
      })
    : null;
  const sourceError = readConnectorSyncSourceError(source);

  if (sourceError) {
    return c.json(sourceError.body, sourceError.status);
  }

  const [syncRun] = await input.db
    .insert(connectorSyncRuns)
    .values(buildConnectorSyncRunValues({
      twinId: input.twinId,
      account: account.value,
      source: source?.value ?? null,
      mode: input.mode,
      requestedBy: input.auth.sub,
    }))
    .returning();

  await input.db.insert(auditEvents).values({
    twinId: input.twinId,
    actorType: input.auth.type,
    actorId: input.auth.sub,
    eventType: "connector.sync_queued",
    resourceType: "connector_sync_run",
    resourceId: syncRun.id,
    metadata: readConnectorSyncAuditMetadata({
      provider: account.value.provider,
      connectorAccountId: account.value.id,
      connectorSourceId: source?.value?.id ?? null,
      mode: input.mode,
    }),
  });

  const queued = input.connectorSyncQueue
    ? await enqueueConnectorSyncJob({
        db: input.db,
        connectorSyncQueue: input.connectorSyncQueue,
        twinId: input.twinId,
        syncRunId: syncRun.id,
        enqueueInput: buildConnectorSyncEnqueueInput({
          syncRunId: syncRun.id,
          twinId: input.twinId,
          account: account.value,
          source: source?.value ?? null,
          mode: input.mode,
        }),
      })
    : null;

  return c.json(
    buildConnectorSyncResponseBody({
      syncRun,
      queued,
      connectorSyncQueueConfigured: Boolean(input.connectorSyncQueue),
    }),
    202,
  );
}
