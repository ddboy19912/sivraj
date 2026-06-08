import type { ConnectorSource } from "../types/connector.types.js";

export function readSlackChannelId(source: ConnectorSource): string {
  const raw = source.externalSourceId || source.uri || "";
  const match = raw.match(/[CGD][A-Z0-9]{2,}/);

  if (!match) {
    throw new Error("invalid_slack_channel_id");
  }

  return match[0]!;
}
