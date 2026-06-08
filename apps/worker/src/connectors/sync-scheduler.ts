import {
  connectorAccounts,
  connectorSources,
  connectorSyncRuns,
  type Db,
} from "@sivraj/db";
import type { ConnectorSyncJobData } from "@sivraj/queue";
import { and, eq, inArray, isNull, lte, ne, or } from "drizzle-orm";

export async function enqueueDueConnectorSyncs(input: {
  db: Db;
  connectorSyncQueue: { enqueueConnectorSync(data: ConnectorSyncJobData): Promise<{ jobId: string }> };
  now?: Date;
  limit?: number;
}) {
  const now = input.now ?? new Date();
  const accounts = await input.db
    .select()
    .from(connectorAccounts)
    .where(
      and(
        eq(connectorAccounts.status, "connected"),
        ne(connectorAccounts.syncCadence, "manual"),
        or(isNull(connectorAccounts.nextSyncAt), lte(connectorAccounts.nextSyncAt, now)),
      ),
    )
    .limit(input.limit ?? 25);
  let queued = 0;

  for (const account of accounts) {
    queued += await enqueueConnectorAccountSyncs(input, account);
  }

  return { scanned: accounts.length, queued };
}

async function enqueueConnectorAccountSyncs(
  input: {
    db: Db;
    connectorSyncQueue: { enqueueConnectorSync(data: ConnectorSyncJobData): Promise<{ jobId: string }> };
  },
  account: typeof connectorAccounts.$inferSelect,
) {
  const sources = await input.db
    .select()
    .from(connectorSources)
    .where(
      and(
        eq(connectorSources.connectorAccountId, account.id),
        eq(connectorSources.status, "connected"),
      ),
    );
  const syncTargets = sources.length > 0 ? sources : [null];
  let queued = 0;

  for (const source of syncTargets) {
    const queuedRun = await enqueueConnectorSyncTarget(input, account, source);
    queued += queuedRun ? 1 : 0;
  }

  return queued;
}

async function createQueuedConnectorSyncRun(
  db: Db,
  account: typeof connectorAccounts.$inferSelect,
  source: typeof connectorSources.$inferSelect | null,
) {
  const [syncRun] = await db
    .insert(connectorSyncRuns)
    .values({
      twinId: account.twinId,
      connectorAccountId: account.id,
      connectorSourceId: source?.id ?? null,
      provider: account.provider,
      mode: account.lastSyncAt ? "incremental" : "initial",
      status: "queued",
      cursorBefore: source?.cursor ?? account.cursor,
      metadata: {
        scheduler: "worker",
      },
    })
    .returning();

  return syncRun;
}

async function enqueueConnectorSyncTarget(
  input: {
    db: Db;
    connectorSyncQueue: { enqueueConnectorSync(data: ConnectorSyncJobData): Promise<{ jobId: string }> };
  },
  account: typeof connectorAccounts.$inferSelect,
  source: typeof connectorSources.$inferSelect | null,
) {
  const activeRun = await findActiveConnectorSyncRun(input.db, account.id, source?.id ?? null);

  if (activeRun) {
    return false;
  }

  const syncRun = await createQueuedConnectorSyncRun(input.db, account, source);

  await input.connectorSyncQueue.enqueueConnectorSync({
    syncRunId: syncRun.id,
    twinId: account.twinId,
    connectorAccountId: account.id,
    connectorSourceId: source?.id ?? null,
    provider: account.provider,
    mode: account.lastSyncAt ? "incremental" : "initial",
  });

  return true;
}

async function findActiveConnectorSyncRun(db: Db, accountId: string, sourceId: string | null) {
  const [activeRun] = await db
    .select({ id: connectorSyncRuns.id })
    .from(connectorSyncRuns)
    .where(
      and(
        eq(connectorSyncRuns.connectorAccountId, accountId),
        sourceId
          ? eq(connectorSyncRuns.connectorSourceId, sourceId)
          : isNull(connectorSyncRuns.connectorSourceId),
        inArray(connectorSyncRuns.status, ["queued", "processing"]),
      ),
    )
    .limit(1);

  return activeRun ?? null;
}
