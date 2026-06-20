import { and, asc, eq, inArray, lt } from "drizzle-orm";
import { sourceArtifacts, type Db } from "@sivraj/db";
import {
  claimArtifactWithStatuses,
  CLAIMABLE_ARTIFACT_STATUSES,
  markArtifact,
  RECOVERABLE_PROCESSING_AGE_MS,
  toQueuedArtifact,
} from "./artifact-helpers.js";

async function findArtifactById(db: Db, id: string) {
  const [row] = await db
    .select()
    .from(sourceArtifacts)
    .where(eq(sourceArtifacts.id, id))
    .limit(1);

  return row ? toQueuedArtifact(row) : null;
}

async function findQueuedArtifacts(db: Db, limit: number) {
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
}

async function claimArtifact(db: Db, id: string) {
  const claimed = await claimArtifactWithStatuses(db, id, CLAIMABLE_ARTIFACT_STATUSES);
  return claimed ? toQueuedArtifact(claimed) : null;
}

async function claimRecoverableArtifact(db: Db, id: string) {
  const staleBefore = new Date(Date.now() - RECOVERABLE_PROCESSING_AGE_MS);
  const claimed = await claimArtifactWithStatuses(db, id, CLAIMABLE_ARTIFACT_STATUSES);

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
}

async function markArtifactPending(
  db: Db,
  id: string,
  metadata: Record<string, unknown>,
) {
  await markArtifact(db, id, "pending", metadata);
}

async function markArtifactProcessing(
  db: Db,
  id: string,
  metadata: Record<string, unknown>,
) {
  await markArtifact(db, id, "processing", metadata);
}

async function markArtifactCompleted(
  db: Db,
  id: string,
  metadata: Record<string, unknown>,
) {
  await markArtifact(db, id, "completed", metadata);
}

async function markArtifactFailed(
  db: Db,
  id: string,
  metadata: Record<string, unknown>,
) {
  await markArtifact(db, id, "failed", metadata);
}

export function createArtifactMethods(db: Db) {
  return {
    findArtifactById: (id: string) => findArtifactById(db, id),
    findQueuedArtifacts: (limit: number) => findQueuedArtifacts(db, limit),
    claimArtifact: (id: string) => claimArtifact(db, id),
    claimRecoverableArtifact: (id: string) => claimRecoverableArtifact(db, id),
    markArtifactProcessing: (id: string, metadata: Record<string, unknown>) =>
      markArtifactProcessing(db, id, metadata),
    markArtifactPending: (id: string, metadata: Record<string, unknown>) =>
      markArtifactPending(db, id, metadata),
    markArtifactCompleted: (id: string, metadata: Record<string, unknown>) =>
      markArtifactCompleted(db, id, metadata),
    markArtifactFailed: (id: string, metadata: Record<string, unknown>) =>
      markArtifactFailed(db, id, metadata),
  };
}
