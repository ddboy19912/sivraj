import {
  auditEvents,
  connectorSyncItems,
  sourceArtifacts,
} from "@sivraj/db";
import { and, eq, isNull } from "drizzle-orm";
import type {
  ConnectorArtifactPayload,
  ConnectorSyncAdapterInput,
  ConnectorSyncAdapterResult,
  StoreConnectorArtifactOptions,
} from "../../types/connector.types.js";
import { asRecord } from "./record.js";

const ENCRYPTED_WALRUS_STORAGE_MODE = "encrypted_walrus";
const DEFAULT_MANUAL_MEMORY_SENSITIVITY = "private";

export async function recordConnectorArtifactSkip(
  input: ConnectorSyncAdapterInput,
  payload: ConnectorArtifactPayload,
  reason: string,
  metadata: Record<string, unknown>,
): Promise<Omit<ConnectorSyncAdapterResult, "cursorAfter" | "nextSyncAt">> {
  await input.db.insert(connectorSyncItems).values({
    twinId: input.syncRun.twinId,
    connectorSyncRunId: input.syncRun.id,
    connectorAccountId: input.account.id,
    connectorSourceId: input.source?.id ?? null,
    externalItemId: payload.externalItemId,
    action: "skipped",
    reason,
    metadata,
  });

  return { addedCount: 0, updatedCount: 0, skippedCount: 1, failedCount: 0 };
}

export function connectorArtifactScope(input: ConnectorSyncAdapterInput) {
  return input.source?.id
    ? and(
        eq(sourceArtifacts.connectorAccountId, input.account.id),
        eq(sourceArtifacts.connectorSourceId, input.source.id),
      )
    : and(
        eq(sourceArtifacts.connectorAccountId, input.account.id),
        isNull(sourceArtifacts.connectorSourceId),
      );
}

export function connectorArtifactMatch(input: ConnectorSyncAdapterInput, contentHash: string) {
  return and(
    connectorArtifactScope(input),
    eq(sourceArtifacts.hash, contentHash),
  );
}

export function buildConnectorArtifactMetadata(
  input: ConnectorSyncAdapterInput,
  payload: ConnectorArtifactPayload,
  contentHash: string,
  stored: {
    ciphertextSha256: string;
    seal: unknown;
    walrus: unknown;
  },
) {
  return {
    storageMode: ENCRYPTED_WALRUS_STORAGE_MODE,
    sensitivity: DEFAULT_MANUAL_MEMORY_SENSITIVITY,
    encryptedPayload: {
      kind: "source_artifact",
      version: 1,
      connectorProvider: payload.provider,
    },
    ciphertextSha256: stored.ciphertextSha256,
    seal: stored.seal,
    walrus: stored.walrus,
    connector: {
      accountId: input.account.id,
      sourceId: input.source?.id ?? null,
      syncRunId: input.syncRun.id,
      provider: payload.provider,
      externalItemId: payload.externalItemId,
      contentHash,
    },
  };
}

export async function insertConnectorArtifactAuditEvent(
  input: ConnectorSyncAdapterInput,
  artifactId: string,
  payload: ConnectorArtifactPayload,
  action: "added" | "updated",
  rawStorageRef: string,
) {
  await input.db.insert(auditEvents).values({
    twinId: input.syncRun.twinId,
    actorType: "system",
    actorId: "sivraj-worker",
    eventType: "connector.artifact_created",
    resourceType: "source_artifact",
    resourceId: artifactId,
    metadata: {
      connectorAccountId: input.account.id,
      connectorSourceId: input.source?.id ?? null,
      connectorSyncRunId: input.syncRun.id,
      provider: payload.provider,
      action,
      rawStorageRef,
    },
  });
}

export function buildConnectorArtifactCounts(
  action: "added" | "updated",
): Omit<ConnectorSyncAdapterResult, "cursorAfter" | "nextSyncAt"> {
  return {
    addedCount: action === "added" ? 1 : 0,
    updatedCount: action === "updated" ? 1 : 0,
    skippedCount: 0,
    failedCount: 0,
  };
}

export function readSyncItemMetadata(
  options: StoreConnectorArtifactOptions,
  artifactId: string,
  payload: ConnectorArtifactPayload,
) {
  return options.buildSyncItemMetadata
    ? options.buildSyncItemMetadata(artifactId)
    : { ...payload.metadata, artifactId };
}

export function readPreviousArtifactMetadata(metadata: unknown): Record<string, unknown> {
  return asRecord(metadata);
}
