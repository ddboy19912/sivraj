import {
  auditEvents,
  candidateMemories,
  connectorSyncItems,
  memoryFragments,
  sourceArtifacts,
} from "@sivraj/db";
import { and, eq, ne } from "drizzle-orm";
import {
  buildConnectorArtifactCounts,
  buildConnectorArtifactMetadata,
  connectorArtifactMatch,
  connectorArtifactScope,
  insertConnectorArtifactAuditEvent,
  readPreviousArtifactMetadata,
  readSyncItemMetadata,
  recordConnectorArtifactSkip,
} from "./shared/storage-helpers.js";
import type {
  ConnectorArtifactPayload,
  ConnectorSyncAdapterInput,
  ConnectorSyncAdapterResult,
  StoreConnectorArtifactOptions,
} from "../types/connector.types.js";
import { sha256 } from "./shared/hash.js";
import { asRecord } from "./shared/record.js";

export async function storeConnectorArtifact(
  input: ConnectorSyncAdapterInput,
  payload: ConnectorArtifactPayload,
  options: StoreConnectorArtifactOptions = {},
): Promise<Omit<ConnectorSyncAdapterResult, "cursorAfter" | "nextSyncAt">> {
  if (options.skipWhen) {
    return recordConnectorArtifactSkip(
      input,
      payload,
      options.skipWhen.reason,
      options.skipWhen.metadata ?? payload.metadata,
    );
  }

  const contentHash = sha256(payload.content);
  const unchanged = await findUnchangedConnectorArtifact(input, contentHash);

  if (unchanged) {
    return recordConnectorArtifactSkip(
      input,
      payload,
      "content_hash_unchanged",
      { ...options.unchangedSkipMetadata ?? payload.metadata, contentHash },
    );
  }

  return createOrUpdateConnectorArtifact(input, payload, contentHash, options);
}

async function findUnchangedConnectorArtifact(
  input: ConnectorSyncAdapterInput,
  contentHash: string,
) {
  const [matchingArtifact] = await input.db
    .select({ id: sourceArtifacts.id })
    .from(sourceArtifacts)
    .where(connectorArtifactMatch(input, contentHash))
    .limit(1);

  return matchingArtifact ?? null;
}

async function createOrUpdateConnectorArtifact(
  input: ConnectorSyncAdapterInput,
  payload: ConnectorArtifactPayload,
  contentHash: string,
  options: StoreConnectorArtifactOptions,
) {
  const [previousArtifact] = await input.db
    .select({ id: sourceArtifacts.id })
    .from(sourceArtifacts)
    .where(connectorArtifactScope(input))
    .limit(1);
  const action = previousArtifact ? "updated" : "added";
  const stored = await input.privateSourceStorage.storePrivateSource({
    twinId: input.syncRun.twinId,
    sourceType: payload.sourceType,
    title: payload.title,
    content: payload.content,
    metadata: payload.metadata,
  });
  const [artifact] = await input.db
    .insert(sourceArtifacts)
    .values({
      twinId: input.syncRun.twinId,
      sourceType: payload.sourceType,
      uri: payload.uri,
      hash: contentHash,
      connectorAccountId: input.account.id,
      connectorSourceId: input.source?.id ?? null,
      connectorSyncRunId: input.syncRun.id,
      metadata: buildConnectorArtifactMetadata(input, payload, contentHash, stored),
      rawStorageRef: stored.rawStorageRef,
      ingestionStatus: "queued",
    })
    .returning();

  await input.db.insert(connectorSyncItems).values({
    twinId: input.syncRun.twinId,
    connectorSyncRunId: input.syncRun.id,
    connectorAccountId: input.account.id,
    connectorSourceId: input.source?.id ?? null,
    sourceArtifactId: artifact.id,
    externalItemId: payload.externalItemId,
    action,
    contentHash,
    metadata: readSyncItemMetadata(options, artifact.id, payload),
  });

  await insertConnectorArtifactAuditEvent(
    input,
    artifact.id,
    payload,
    action,
    stored.rawStorageRef,
  );

  if (action === "updated") {
    await supersedePreviousConnectorArtifacts(input, {
      provider: payload.provider,
      newArtifactId: artifact.id,
      externalItemId: payload.externalItemId,
      contentHash,
    });
  }

  await input.artifactProcessingQueue.enqueueArtifactProcessing({
    artifactId: artifact.id,
    twinId: input.syncRun.twinId,
    sourceType: payload.sourceType,
    ...(stored.encryptedBytesBase64
      ? {
          transientCiphertextBase64: stored.encryptedBytesBase64,
          transientCiphertextSha256: stored.ciphertextSha256,
        }
      : {}),
  });

  return buildConnectorArtifactCounts(action);
}

async function supersedePreviousConnectorArtifacts(
  input: ConnectorSyncAdapterInput,
  supersession: {
    provider: string;
    newArtifactId: string;
    externalItemId: string;
    contentHash: string;
  },
) {
  const connectorSourceId = input.source?.id;
  const now = new Date();
  const previousArtifacts = await input.db
    .select({
      id: sourceArtifacts.id,
      metadata: sourceArtifacts.metadata,
    })
    .from(sourceArtifacts)
    .where(
      and(
        connectorArtifactScope(input),
        ne(sourceArtifacts.id, supersession.newArtifactId),
      ),
    );

  for (const previousArtifact of previousArtifacts) {
    await supersedeConnectorArtifact(input, previousArtifact, supersession, now, connectorSourceId);
  }
}

async function supersedeConnectorArtifact(
  input: ConnectorSyncAdapterInput,
  previousArtifact: { id: string; metadata: unknown },
  supersession: {
    provider: string;
    newArtifactId: string;
    externalItemId: string;
    contentHash: string;
  },
  now: Date,
  connectorSourceId: string | undefined,
) {
  await input.db
    .update(sourceArtifacts)
    .set({
      metadata: {
        ...readPreviousArtifactMetadata(previousArtifact.metadata),
        supersededByArtifactId: supersession.newArtifactId,
        supersededAt: now.toISOString(),
        supersededReason: "connector_source_updated",
      },
      updatedAt: now,
    })
    .where(and(
      eq(sourceArtifacts.id, previousArtifact.id),
      eq(sourceArtifacts.twinId, input.syncRun.twinId),
    ));

  const fragments = await input.db
    .select({
      id: memoryFragments.id,
      metadata: memoryFragments.metadata,
    })
    .from(memoryFragments)
    .where(and(
      eq(memoryFragments.sourceArtifactId, previousArtifact.id),
      eq(memoryFragments.twinId, input.syncRun.twinId),
    ));

  for (const fragment of fragments) {
    await input.db
      .update(memoryFragments)
      .set({
        metadata: {
          ...asRecord(fragment.metadata),
          supersededByArtifactId: supersession.newArtifactId,
          supersededAt: now.toISOString(),
          supersededReason: "connector_source_updated",
        },
        updatedAt: now,
      })
      .where(and(
        eq(memoryFragments.id, fragment.id),
        eq(memoryFragments.twinId, input.syncRun.twinId),
      ));
  }

  await input.db
    .update(candidateMemories)
    .set({
      status: "superseded",
      updatedAt: now,
    })
    .where(and(
      eq(candidateMemories.sourceArtifactId, previousArtifact.id),
      eq(candidateMemories.twinId, input.syncRun.twinId),
    ));

  await input.db.insert(auditEvents).values({
    twinId: input.syncRun.twinId,
    actorType: "system",
    actorId: "sivraj-worker",
    resourceType: "source_artifact",
    resourceId: previousArtifact.id,
    eventType: "connector.artifact_superseded",
    metadata: {
      connectorAccountId: input.account.id,
      connectorSourceId: connectorSourceId ?? null,
      connectorSyncRunId: input.syncRun.id,
      provider: supersession.provider,
      externalItemId: supersession.externalItemId,
      newArtifactId: supersession.newArtifactId,
      contentHash: supersession.contentHash,
    },
  });
}
