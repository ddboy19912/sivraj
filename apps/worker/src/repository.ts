import { and, asc, eq, inArray, lt } from "drizzle-orm";
import {
  auditEvents,
  memoryFragments,
  sourceArtifacts,
  type Db,
} from "@sivraj/db";
import type {
  ArtifactRepository,
  QueuedArtifact,
} from "./ingestion-processor.js";

const CLAIMABLE_ARTIFACT_STATUSES: Array<"queued" | "pending"> = [
  "queued",
  "pending",
];
const RECOVERABLE_PROCESSING_AGE_MS = 5 * 60 * 1000;

export function createDrizzleArtifactRepository(db: Db): ArtifactRepository {
  return {
    async findQueuedArtifacts(limit) {
      const rows = await db
        .select()
        .from(sourceArtifacts)
        .where(
          inArray(sourceArtifacts.ingestionStatus, [
            "queued",
            "pending",
            "processing",
          ]),
        )
        .orderBy(asc(sourceArtifacts.createdAt))
        .limit(limit);

      return rows.map(toQueuedArtifact);
    },
    async claimArtifact(id) {
      const [claimed] = await db
        .update(sourceArtifacts)
        .set({
          ingestionStatus: "processing",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(sourceArtifacts.id, id),
            inArray(
              sourceArtifacts.ingestionStatus,
              CLAIMABLE_ARTIFACT_STATUSES,
            ),
          ),
        )
        .returning();

      return claimed ? toQueuedArtifact(claimed) : null;
    },
    async claimRecoverableArtifact(id) {
      const staleBefore = new Date(Date.now() - RECOVERABLE_PROCESSING_AGE_MS);
      const [claimed] = await db
        .update(sourceArtifacts)
        .set({
          ingestionStatus: "processing",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(sourceArtifacts.id, id),
            inArray(
              sourceArtifacts.ingestionStatus,
              CLAIMABLE_ARTIFACT_STATUSES,
            ),
          ),
        )
        .returning();

      if (claimed) {
        return toQueuedArtifact(claimed);
      }

      const [staleClaimed] = await db
        .update(sourceArtifacts)
        .set({
          ingestionStatus: "processing",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(sourceArtifacts.id, id),
            eq(sourceArtifacts.ingestionStatus, "processing"),
            lt(sourceArtifacts.updatedAt, staleBefore),
          ),
        )
        .returning();

      return staleClaimed ? toQueuedArtifact(staleClaimed) : null;
    },
    async markArtifactPending(id, metadata) {
      await markArtifact(db, id, "pending", metadata);
    },
    async markArtifactCompleted(id, metadata) {
      await markArtifact(db, id, "completed", metadata);
    },
    async markArtifactFailed(id, metadata) {
      await markArtifact(db, id, "failed", metadata);
    },
    async findMemoryFragmentBySourceArtifactId(sourceArtifactId) {
      const [fragment] = await db
        .select({ id: memoryFragments.id })
        .from(memoryFragments)
        .where(eq(memoryFragments.sourceArtifactId, sourceArtifactId))
        .limit(1);

      return fragment ?? null;
    },
    async createMemoryFragment(input) {
      const [fragment] = await db
        .insert(memoryFragments)
        .values({
          twinId: input.twinId,
          sourceArtifactId: input.sourceArtifactId,
          contentStorageRef: input.contentStorageRef,
          contentSha256: input.contentSha256 ?? null,
          metadata: input.metadata ?? null,
          importanceScore: input.importanceScore,
          confidenceScore: input.confidenceScore,
        })
        .returning({ id: memoryFragments.id });

      if (!fragment) {
        throw new Error("Failed to create memory fragment");
      }

      return fragment;
    },
    async createAuditEvent(input) {
      await db.insert(auditEvents).values({
        twinId: input.twinId,
        actorType: "system",
        actorId: "sivraj-worker",
        eventType: input.eventType,
        resourceType: "source_artifact",
        resourceId: input.resourceId,
        metadata: input.metadata,
      });
    },
  };
}

async function markArtifact(
  db: Db,
  id: string,
  status: "pending" | "completed" | "failed",
  metadata: Record<string, unknown>,
) {
  await db
    .update(sourceArtifacts)
    .set({
      ingestionStatus: status,
      metadata,
      updatedAt: new Date(),
    })
    .where(eq(sourceArtifacts.id, id));
}

function toQueuedArtifact(
  row: typeof sourceArtifacts.$inferSelect,
): QueuedArtifact {
  return {
    id: row.id,
    twinId: row.twinId,
    sourceType: row.sourceType,
    rawStorageRef: row.rawStorageRef,
    metadata: row.metadata,
  };
}
