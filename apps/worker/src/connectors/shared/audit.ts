import type { ConnectorSyncJobData } from "@sivraj/queue";

export function connectorAuditMetadata(data: ConnectorSyncJobData): Record<string, unknown> {
  return {
    connectorAccountId: data.connectorAccountId,
    connectorSourceId: data.connectorSourceId ?? null,
    provider: data.provider,
    mode: data.mode,
  };
}
