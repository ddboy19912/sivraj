import { connectorSyncItems } from "@sivraj/db";
import type {
  ConnectorArtifactSourceType,
  ConnectorSyncAdapterInput,
  ConnectorSyncAdapterResult,
} from "../types/connector.types.js";
import { errorMessage } from "./shared/error-message.js";
import { storeConnectorArtifact } from "./storage.js";
import { nextSyncAt } from "./sync-timing.js";

export type DriveDocumentImportResult = {
  provider: "google_drive" | "microsoft_onedrive";
  sourceType: ConnectorArtifactSourceType;
  externalItemId: string;
  title: string;
  content: string;
  uri: string | null;
  metadata: {
    importer: "google_drive_file" | "microsoft_onedrive_item";
    fileId: string;
    fileName: string;
    mimeType: string | null;
    modifiedTime: string | null;
  };
};

export async function storeDocumentImports(
  input: ConnectorSyncAdapterInput,
  imports: DriveDocumentImportResult[],
  provider: "google_drive" | "microsoft_onedrive",
): Promise<ConnectorSyncAdapterResult> {
  if (imports.length === 0) {
    return skipDocumentImports(input, provider);
  }

  const counts = {
    addedCount: 0,
    updatedCount: 0,
    skippedCount: 0,
    failedCount: 0,
  };
  let cursorAfter = input.source?.cursor ?? input.account.cursor ?? null;

  for (const item of imports) {
    cursorAfter = await storeDocumentImportItem(input, item, counts, cursorAfter);
  }

  return {
    cursorAfter,
    nextSyncAt: nextSyncAt(input.account.syncCadence),
    ...counts,
  };
}

async function skipDocumentImports(
  input: ConnectorSyncAdapterInput,
  provider: "google_drive" | "microsoft_onedrive",
): Promise<ConnectorSyncAdapterResult> {
  await input.db.insert(connectorSyncItems).values({
    twinId: input.syncRun.twinId,
    connectorSyncRunId: input.syncRun.id,
    connectorAccountId: input.account.id,
    connectorSourceId: input.source?.id ?? null,
    externalItemId: `${provider}:source`,
    action: "skipped",
    reason: "no_supported_documents_found",
    metadata: { provider },
  });

  return {
    cursorAfter: input.source?.cursor ?? input.account.cursor,
    nextSyncAt: nextSyncAt(input.account.syncCadence),
    addedCount: 0,
    updatedCount: 0,
    skippedCount: 1,
    failedCount: 0,
  };
}

async function storeDocumentImportItem(
  input: ConnectorSyncAdapterInput,
  item: DriveDocumentImportResult,
  counts: Pick<ConnectorSyncAdapterResult, "addedCount" | "updatedCount" | "skippedCount" | "failedCount">,
  cursorAfter: string | null,
) {
  try {
    const result = await storeConnectorArtifact(input, item);
    counts.addedCount += result.addedCount;
    counts.updatedCount += result.updatedCount;
    counts.skippedCount += result.skippedCount;
    counts.failedCount += result.failedCount;

    if (item.metadata.modifiedTime && (!cursorAfter || item.metadata.modifiedTime > cursorAfter)) {
      return item.metadata.modifiedTime;
    }
  } catch (error) {
    counts.failedCount += 1;
    await input.db.insert(connectorSyncItems).values({
      twinId: input.syncRun.twinId,
      connectorSyncRunId: input.syncRun.id,
      connectorAccountId: input.account.id,
      connectorSourceId: input.source?.id ?? null,
      externalItemId: item.externalItemId,
      action: "failed",
      reason: errorMessage(error),
      metadata: item.metadata,
    });
  }

  return cursorAfter;
}
