import {
  auditEvents,
  connectorAccounts,
  connectorSources,
  connectorSyncRuns,
  type Db,
} from "@sivraj/db";
import type { ArtifactProcessingQueue, ConnectorSyncJobData } from "@sivraj/queue";
import { eq } from "drizzle-orm";
import type { ConnectorSyncAdapter, ConnectorSyncAdapterResult } from "../types/connector.types.js";
import type { PrivateSourceStorage } from "../private-source-storage.js";
import { connectorAuditMetadata } from "./shared/audit.js";
import { connectorErrorCode } from "./shared/error-code.js";
import { errorMessage } from "./shared/error-message.js";
import { nextSyncAt, updateConnectorSyncTimestamps } from "./sync-timing.js";

export type ProcessConnectorSyncRunInput = {
  db: Db;
  data: ConnectorSyncJobData;
  privateSourceStorage?: PrivateSourceStorage;
  artifactProcessingQueue: ArtifactProcessingQueue;
  adapters?: ConnectorSyncAdapter[];
  resolveAdapters?: () => ConnectorSyncAdapter[];
  completePlaceholderSync?: (
    db: Db,
    data: ConnectorSyncJobData,
    input: { reason: string },
  ) => Promise<ConnectorSyncRunResult>;
};

export type ConnectorSyncRunResult = {
  status: string;
  addedCount: number;
  updatedCount: number;
  skippedCount: number;
  failedCount: number;
};

type ConnectorSyncContext = {
  syncRun: NonNullable<Awaited<ReturnType<typeof loadConnectorSyncContext>>["syncRun"]>;
  account: NonNullable<Awaited<ReturnType<typeof loadConnectorSyncContext>>["account"]>;
  source: Awaited<ReturnType<typeof loadConnectorSyncContext>>["source"];
};

async function markConnectorSyncProcessing(db: Db, syncRunId: string, startedAt: Date) {
  await db
    .update(connectorSyncRuns)
    .set({
      status: "processing",
      startedAt,
      updatedAt: startedAt,
    })
    .where(eq(connectorSyncRuns.id, syncRunId));
}

async function recordConnectorSyncStarted(db: Db, data: ConnectorSyncJobData) {
  await db.insert(auditEvents).values({
    twinId: data.twinId,
    actorType: "system",
    actorId: "sivraj-worker",
    eventType: "connector.sync_started",
    resourceType: "connector_sync_run",
    resourceId: data.syncRunId,
    metadata: connectorAuditMetadata(data),
  });
}

async function loadConnectorSyncContext(input: ProcessConnectorSyncRunInput) {
  const { db, data } = input;
  const [syncRun] = await db
    .select()
    .from(connectorSyncRuns)
    .where(eq(connectorSyncRuns.id, data.syncRunId))
    .limit(1);
  const [account] = await db
    .select()
    .from(connectorAccounts)
    .where(eq(connectorAccounts.id, data.connectorAccountId))
    .limit(1);
  const [source] = data.connectorSourceId
    ? await db
        .select()
        .from(connectorSources)
        .where(eq(connectorSources.id, data.connectorSourceId))
        .limit(1)
    : [null];

  if (!syncRun || !account) {
    throw new Error("connector_sync_context_not_found");
  }

  if (!input.privateSourceStorage) {
    throw new Error("private_source_storage_not_configured");
  }

  return { syncRun, account, source, privateSourceStorage: input.privateSourceStorage };
}

async function completeConnectorSyncSuccess(
  input: ProcessConnectorSyncRunInput,
  context: ConnectorSyncContext,
  result: ConnectorSyncAdapterResult,
): Promise<ConnectorSyncRunResult> {
  const completedAt = new Date();
  const [updated] = await input.db
    .update(connectorSyncRuns)
    .set({
      status: "completed",
      cursorAfter: result.cursorAfter ?? context.source?.cursor ?? context.account.cursor,
      addedCount: result.addedCount,
      updatedCount: result.updatedCount,
      skippedCount: result.skippedCount,
      failedCount: result.failedCount,
      completedAt,
      updatedAt: completedAt,
    })
    .where(eq(connectorSyncRuns.id, input.data.syncRunId))
    .returning();

  await updateConnectorSyncTimestamps(input.db, {
    account: context.account,
    source: context.source,
    completedAt,
    cursorAfter: result.cursorAfter,
    nextSyncAt: result.nextSyncAt ?? nextSyncAt(context.account.syncCadence, completedAt),
  });

  await input.db.insert(auditEvents).values({
    twinId: input.data.twinId,
    actorType: "system",
    actorId: "sivraj-worker",
    eventType: "connector.sync_completed",
    resourceType: "connector_sync_run",
    resourceId: input.data.syncRunId,
    metadata: {
      ...connectorAuditMetadata(input.data),
      addedCount: result.addedCount,
      updatedCount: result.updatedCount,
      skippedCount: result.skippedCount,
      failedCount: result.failedCount,
    },
  });

  return updated
    ? {
        status: updated.status,
        addedCount: updated.addedCount,
        updatedCount: updated.updatedCount,
        skippedCount: updated.skippedCount,
        failedCount: updated.failedCount,
      }
    : { status: "completed", ...result };
}

async function failConnectorSyncRun(
  input: ProcessConnectorSyncRunInput,
  error: unknown,
): Promise<ConnectorSyncRunResult> {
  const completedAt = new Date();
  const [failed] = await input.db
    .update(connectorSyncRuns)
    .set({
      status: "failed",
      failedCount: 1,
      errorCode: connectorErrorCode(error),
      errorMessage: errorMessage(error),
      completedAt,
      updatedAt: completedAt,
    })
    .where(eq(connectorSyncRuns.id, input.data.syncRunId))
    .returning();

  await input.db
    .update(connectorAccounts)
    .set({
      status: "error",
      errorCode: connectorErrorCode(error),
      updatedAt: completedAt,
    })
    .where(eq(connectorAccounts.id, input.data.connectorAccountId));

  await input.db.insert(auditEvents).values({
    twinId: input.data.twinId,
    actorType: "system",
    actorId: "sivraj-worker",
    eventType: "connector.sync_failed",
    resourceType: "connector_sync_run",
    resourceId: input.data.syncRunId,
    metadata: {
      ...connectorAuditMetadata(input.data),
      error: errorMessage(error),
    },
  });

  return failed
    ? {
        status: failed.status,
        addedCount: failed.addedCount,
        updatedCount: failed.updatedCount,
        skippedCount: failed.skippedCount,
        failedCount: failed.failedCount,
      }
    : {
        status: "failed",
        addedCount: 0,
        updatedCount: 0,
        skippedCount: 0,
        failedCount: 1,
      };
}

export async function executeConnectorSyncRun(
  input: ProcessConnectorSyncRunInput,
): Promise<ConnectorSyncRunResult> {
  const startedAt = new Date();

  await markConnectorSyncProcessing(input.db, input.data.syncRunId, startedAt);
  await recordConnectorSyncStarted(input.db, input.data);

  try {
    const context = await loadConnectorSyncContext(input);
    const adapters = input.adapters ?? input.resolveAdapters?.() ?? [];
    const adapter = adapters.find((candidate) => candidate.provider === input.data.provider);

    if (!adapter) {
      const completePlaceholder = input.completePlaceholderSync;

      if (!completePlaceholder) {
        throw new Error("connector_sync_adapter_not_implemented");
      }

      return await completePlaceholder(input.db, input.data, {
        reason: "provider_sync_adapter_not_implemented",
      });
    }

    const result = await adapter.sync({
      db: input.db,
      syncRun: context.syncRun,
      account: context.account,
      source: context.source,
      privateSourceStorage: context.privateSourceStorage,
      artifactProcessingQueue: input.artifactProcessingQueue,
    });

    return await completeConnectorSyncSuccess(input, context, result);
  } catch (error) {
    return await failConnectorSyncRun(input, error);
  }
}
