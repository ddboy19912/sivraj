import { connectorSyncItems } from "@sivraj/db";
import type { ConnectorSyncAdapterInput, ConnectorSyncAdapterResult } from "../types/connector.types.js";
import { errorMessage } from "./shared/error-message.js";
import { storeConnectorArtifact } from "./storage.js";
import { nextSyncAt } from "./sync-timing.js";

type EmailImportResult = {
  messageId: string;
  title: string;
  content: string;
  metadata: Record<string, unknown>;
};

export async function syncImportedGmailMessages(
  adapterInput: ConnectorSyncAdapterInput,
  imported: {
    messages: EmailImportResult[];
    cursorAfter: string | null;
    query: string;
  },
): Promise<ConnectorSyncAdapterResult> {
  if (imported.messages.length === 0) {
    return skipGmailSync(adapterInput, imported.query);
  }

  const counts = {
    addedCount: 0,
    updatedCount: 0,
    skippedCount: 0,
    failedCount: 0,
  };

  for (const message of imported.messages) {
    await syncGmailMessage(adapterInput, message, counts);
  }

  return {
    cursorAfter: imported.cursorAfter ?? adapterInput.source?.cursor ?? adapterInput.account.cursor,
    nextSyncAt: nextSyncAt(adapterInput.account.syncCadence),
    ...counts,
  };
}

async function skipGmailSync(adapterInput: ConnectorSyncAdapterInput, query: string) {
  await adapterInput.db.insert(connectorSyncItems).values({
    twinId: adapterInput.syncRun.twinId,
    connectorSyncRunId: adapterInput.syncRun.id,
    connectorAccountId: adapterInput.account.id,
    connectorSourceId: adapterInput.source?.id ?? null,
    externalItemId: "gmail:messages",
    action: "skipped",
    reason: "gmail_no_new_messages",
    metadata: {
      importer: "gmail_message",
      query,
    },
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

async function syncGmailMessage(
  adapterInput: ConnectorSyncAdapterInput,
  message: EmailImportResult,
  counts: Pick<ConnectorSyncAdapterResult, "addedCount" | "updatedCount" | "skippedCount" | "failedCount">,
) {
  try {
    const result = await storeConnectorArtifact(adapterInput, {
      provider: "email",
      sourceType: "email",
      title: message.title,
      content: message.content,
      uri: `gmail://message/${message.messageId}`,
      externalItemId: message.messageId,
      metadata: message.metadata,
    });

    counts.addedCount += result.addedCount;
    counts.updatedCount += result.updatedCount;
    counts.skippedCount += result.skippedCount;
    counts.failedCount += result.failedCount;
  } catch (error) {
    counts.failedCount += 1;
    await adapterInput.db.insert(connectorSyncItems).values({
      twinId: adapterInput.syncRun.twinId,
      connectorSyncRunId: adapterInput.syncRun.id,
      connectorAccountId: adapterInput.account.id,
      connectorSourceId: adapterInput.source?.id ?? null,
      externalItemId: message.messageId,
      action: "failed",
      reason: errorMessage(error),
      metadata: message.metadata,
    });
  }
}
