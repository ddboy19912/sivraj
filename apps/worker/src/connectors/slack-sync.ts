import type { ConnectorSyncAdapterInput } from "../types/connector.types.js";
import { readSlackChannelId } from "./slack-reader.js";
import { importSlackChannel } from "./slack-import.js";
import { storeConnectorArtifact } from "./storage.js";
import { nextSyncAt } from "./sync-timing.js";

export function buildSlackSyncSkipMetadata(channelName: string) {
  return {
    channelName,
    messageCount: 0,
    skipped: true,
  };
}

export async function runSlackConnectorSync(input: {
  adapterInput: ConnectorSyncAdapterInput;
  token: string;
  fetcher?: typeof fetch;
}) {
  if (!input.adapterInput.source) {
    throw new Error("slack_connector_source_required");
  }

  if (!input.token) {
    throw new Error("slack_bot_token_not_configured");
  }

  const channelId = readSlackChannelId(input.adapterInput.source);
  const imported = await importSlackChannel({
    channelId,
    token: input.token,
    oldest: input.adapterInput.source.cursor ?? input.adapterInput.account.cursor ?? undefined,
    fetcher: input.fetcher ?? fetch,
  });

  const result = await storeConnectorArtifact(input.adapterInput, {
    provider: "slack",
    sourceType: "slack_export",
    title: `Slack #${imported.channelName}`,
    content: imported.content,
    uri: input.adapterInput.source?.uri ?? imported.channelId,
    externalItemId: imported.channelId,
    metadata: imported.metadata,
  }, !imported.metadata.messageCount
    ? {
        skipWhen: {
          reason: "slack_channel_no_new_messages",
          metadata: imported.metadata,
        },
      }
    : {});

  return {
    cursorAfter: imported.metadata.latest ?? input.adapterInput.source.cursor ?? input.adapterInput.account.cursor,
    nextSyncAt: nextSyncAt(input.adapterInput.account.syncCadence),
    ...result,
  };
}
