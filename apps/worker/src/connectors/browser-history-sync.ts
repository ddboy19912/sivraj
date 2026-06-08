import { connectorSyncItems } from "@sivraj/db";
import { readBrowserHistoryContent } from "./browser-history-reader.js";
import { storeConnectorArtifact } from "./storage.js";
import type { ConnectorSyncAdapterInput, ConnectorSyncAdapterResult } from "../types/connector.types.js";
import { nextSyncAt } from "./sync-timing.js";
import { sha256 } from "./shared/hash.js";

async function skipBrowserHistorySync(
  adapterInput: ConnectorSyncAdapterInput,
): Promise<ConnectorSyncAdapterResult> {
  await adapterInput.db.insert(connectorSyncItems).values({
    twinId: adapterInput.syncRun.twinId,
    connectorSyncRunId: adapterInput.syncRun.id,
    connectorAccountId: adapterInput.account.id,
    connectorSourceId: adapterInput.source?.id ?? null,
    externalItemId: "browser_history_import",
    action: "skipped",
    reason: "browser_history_content_not_provided",
    metadata: { importer: "browser_history_connector_import" },
  });

  return {
    cursorAfter: adapterInput.source?.cursor ?? adapterInput.account.cursor,
    nextSyncAt: nextSyncAt(adapterInput.account.syncCadence),
    addedCount: 0,
    updatedCount: 0,
    skippedCount: 1,
    failedCount: 0,
  };
}

export async function syncBrowserHistoryConnector(
  adapterInput: ConnectorSyncAdapterInput,
): Promise<ConnectorSyncAdapterResult> {
  const content = readBrowserHistoryContent(adapterInput.source, adapterInput.account.metadata);

  if (!content) {
    return skipBrowserHistorySync(adapterInput);
  }

  const result = await storeConnectorArtifact(adapterInput, {
    provider: "browser_history",
    sourceType: "browser_history",
    title: adapterInput.source?.displayName ?? "Browser history import",
    content,
    uri: adapterInput.source?.uri ?? null,
    externalItemId: adapterInput.source?.externalSourceId ?? "browser_history_import",
    metadata: {
      importer: "browser_history_connector_import",
      sourceName: adapterInput.source?.displayName ?? null,
    },
  });

  return {
    cursorAfter: sha256(content),
    nextSyncAt: nextSyncAt(adapterInput.account.syncCadence),
    ...result,
  };
}
