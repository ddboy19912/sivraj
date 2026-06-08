import { and, eq, inArray } from "drizzle-orm";
import { sourceArtifacts, type Db } from "@sivraj/db";
import type { QueuedArtifact } from "../ingestion-processor.js";

export const CLAIMABLE_ARTIFACT_STATUSES: Array<"queued" | "pending"> = [
  "queued",
  "pending",
];
export const RECOVERABLE_PROCESSING_AGE_MS = 5 * 60 * 1000;

export function toQueuedArtifact(
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

export async function claimArtifactWithStatuses(
  db: Db,
  id: string,
  statuses: Array<"queued" | "pending">,
) {
  const [claimed] = await db
    .update(sourceArtifacts)
    .set({
      ingestionStatus: "processing",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(sourceArtifacts.id, id),
        inArray(sourceArtifacts.ingestionStatus, statuses),
      ),
    )
    .returning();

  return claimed ?? null;
}

export async function markArtifact(
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
