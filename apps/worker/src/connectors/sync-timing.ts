import { connectorAccounts, connectorSources, type Db } from "@sivraj/db";
import { eq } from "drizzle-orm";
import type { ConnectorAccount, ConnectorSource } from "../types/connector.types.js";

export function syncCadenceToMs(syncCadence: string): number | null {
  if (syncCadence === "hourly") {
    return 60 * 60 * 1000;
  }

  if (syncCadence === "daily") {
    return 24 * 60 * 60 * 1000;
  }

  if (syncCadence === "weekly") {
    return 7 * 24 * 60 * 60 * 1000;
  }

  const match = /^every_(\d+)_minutes$/.exec(syncCadence);

  if (!match) {
    return null;
  }

  return Number.parseInt(match[1]!, 10) * 60 * 1000;
}

export function nextSyncAt(syncCadence: string, from: Date = new Date()): Date | null {
  const intervalMs = syncCadenceToMs(syncCadence);
  return intervalMs ? new Date(from.getTime() + intervalMs) : null;
}

export function updateConnectorSyncTimestamps(
  db: Db,
  input: {
    account: ConnectorAccount;
    source: ConnectorSource | null;
    completedAt: Date;
    cursorAfter?: string | null;
    nextSyncAt?: Date | null;
  },
) {
  return Promise.all([
    db
      .update(connectorAccounts)
      .set({
        lastSyncAt: input.completedAt,
        nextSyncAt: input.nextSyncAt ?? null,
        cursor: input.cursorAfter ?? input.account.cursor,
        errorCode: null,
        updatedAt: input.completedAt,
      })
      .where(eq(connectorAccounts.id, input.account.id)),
    input.source
      ? db
          .update(connectorSources)
          .set({
            lastSyncAt: input.completedAt,
            nextSyncAt: input.nextSyncAt ?? null,
            cursor: input.cursorAfter ?? input.source.cursor,
            errorCode: null,
            updatedAt: input.completedAt,
          })
          .where(eq(connectorSources.id, input.source.id))
      : Promise.resolve(),
  ]);
}
