import { and, asc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { candidateMemories, candidateMemoryArchives, type Db } from "@sivraj/db";
import { upsertCanonicalMemory } from "./canonical-memory-repository.js";
import { buildCandidateConsolidationMetadata } from "./candidate-memory-metadata.js";
import { asRecord } from "./helpers.js";

type CandidateMemoryInput = {
  twinId: string;
  sourceArtifactId: string;
  memoryFragmentId: string;
  archiveId?: string | null;
  memoryType: typeof candidateMemories.$inferSelect["memoryType"];
  statement?: string;
  normalizedStatement?: string;
  statementStorageRef: string;
  statementSha256: string;
  evidenceHash: string;
  evidenceLength: number;
  confidenceScore: number;
  archiveStatus?: typeof candidateMemories.$inferSelect["archiveStatus"];
  metadata: Record<string, unknown>;
  mergeJudge?: Parameters<typeof upsertCanonicalMemory>[1]["mergeJudge"];
};

async function createCandidateMemory(db: Db, input: CandidateMemoryInput) {
  const canonicalMemory = await upsertCanonicalMemory(db, input);
  const [existing] = await db
    .select({ id: candidateMemories.id })
    .from(candidateMemories)
    .where(
      and(
        eq(candidateMemories.memoryFragmentId, input.memoryFragmentId),
        eq(candidateMemories.memoryType, input.memoryType),
        eq(candidateMemories.evidenceHash, input.evidenceHash),
      ),
    )
    .limit(1);

  if (existing) {
    await updateExistingCandidateMemory(db, existing.id, input, canonicalMemory);
    return {
      id: existing.id,
      canonicalMemoryId: canonicalMemory.id,
    };
  }

  return insertCandidateMemory(db, input, canonicalMemory);
}

async function markCandidateMemoriesArchived(
  db: Db,
  input: {
    archiveId?: string | null;
    candidateMemoryIds: string[];
    statementStorageRef: string;
    statementSha256: string;
    metadata: Record<string, unknown>;
  },
) {
  if (input.candidateMemoryIds.length === 0) {
    return;
  }

  const rows = await db
    .select({
      id: candidateMemories.id,
      metadata: candidateMemories.metadata,
    })
    .from(candidateMemories)
    .where(inArray(candidateMemories.id, input.candidateMemoryIds));

  for (const row of rows) {
    await db
      .update(candidateMemories)
      .set({
        statementStorageRef: input.statementStorageRef,
        statementSha256: input.statementSha256,
        archiveStatus: "archived",
        archiveErrorCode: null,
        archiveErrorMessage: null,
        archiveNextRetryAt: null,
        archiveCompletedAt: new Date(),
        metadata: {
          ...asRecord(row.metadata),
          ...input.metadata,
        },
        updatedAt: new Date(),
      })
      .where(eq(candidateMemories.id, row.id));
  }

  if (input.archiveId) {
    await db
      .update(candidateMemoryArchives)
      .set({
        status: "archived",
        storageRef: input.statementStorageRef,
        storageSha256: input.statementSha256,
        errorCode: null,
        errorMessage: null,
        nextRetryAt: null,
        completedAt: new Date(),
        metadata: input.metadata,
        updatedAt: new Date(),
      })
      .where(eq(candidateMemoryArchives.id, input.archiveId));
  }
}

async function markCandidateMemoriesArchiveFailed(
  db: Db,
  input: {
    archiveId?: string | null;
    candidateMemoryIds: string[];
    metadata: Record<string, unknown>;
  },
) {
  if (input.candidateMemoryIds.length === 0) {
    return;
  }

  const failure = candidateArchiveFailureFields(input.metadata);
  const rows = await db
    .select({
      id: candidateMemories.id,
      metadata: candidateMemories.metadata,
    })
    .from(candidateMemories)
    .where(inArray(candidateMemories.id, input.candidateMemoryIds));

  for (const row of rows) {
    await db
      .update(candidateMemories)
      .set({
        archiveStatus: failure.status,
        archiveErrorCode: failure.errorCode,
        archiveErrorMessage: failure.errorMessage,
        archiveNextRetryAt: failure.nextRetryAt,
        archiveLastAttemptedAt: new Date(),
        metadata: {
          ...asRecord(row.metadata),
          ...input.metadata,
        },
        updatedAt: new Date(),
      })
      .where(eq(candidateMemories.id, row.id));
  }

  if (input.archiveId) {
    const [row] = await db
      .select({
        metadata: candidateMemoryArchives.metadata,
      })
      .from(candidateMemoryArchives)
      .where(eq(candidateMemoryArchives.id, input.archiveId))
      .limit(1);

    await db
      .update(candidateMemoryArchives)
      .set({
        status: failure.status,
        errorCode: failure.errorCode,
        errorMessage: failure.errorMessage,
        nextRetryAt: failure.nextRetryAt,
        lastAttemptedAt: new Date(),
        metadata: {
          ...asRecord(row?.metadata),
          ...input.metadata,
        },
        updatedAt: new Date(),
      })
      .where(eq(candidateMemoryArchives.id, input.archiveId));
  }
}

async function createCandidateMemoryArchive(
  db: Db,
  input: {
    twinId: string;
    sourceArtifactId: string;
    memoryFragmentId: string;
    sourceType: string;
    candidateMemoryIds: string[];
    encryptedBytesBase64: string;
    contentSha256: string;
    metadata: Record<string, unknown>;
  },
) {
  const [existing] = await db
    .select({ id: candidateMemoryArchives.id })
    .from(candidateMemoryArchives)
    .where(
      and(
        eq(candidateMemoryArchives.memoryFragmentId, input.memoryFragmentId),
        eq(candidateMemoryArchives.contentSha256, input.contentSha256),
      ),
    )
    .limit(1);

  if (existing) {
    await db
      .update(candidateMemoryArchives)
      .set({
        candidateMemoryIds: input.candidateMemoryIds,
        encryptedBytesBase64: input.encryptedBytesBase64,
        metadata: input.metadata,
        status: "pending",
        errorCode: null,
        errorMessage: null,
        nextRetryAt: null,
        completedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(candidateMemoryArchives.id, existing.id));
    return existing;
  }

  const [created] = await db
    .insert(candidateMemoryArchives)
    .values({
      twinId: input.twinId,
      sourceArtifactId: input.sourceArtifactId,
      memoryFragmentId: input.memoryFragmentId,
      sourceType: input.sourceType,
      candidateMemoryIds: input.candidateMemoryIds,
      encryptedBytesBase64: input.encryptedBytesBase64,
      contentSha256: input.contentSha256,
      status: "pending",
      metadata: input.metadata,
    })
    .returning({ id: candidateMemoryArchives.id });

  return created!;
}

async function markCandidateMemoryArchiveQueued(
  db: Db,
  input: {
    archiveId: string;
    candidateMemoryIds: string[];
    jobId: string;
  },
) {
  await db
    .update(candidateMemoryArchives)
    .set({
      status: "queued",
      jobId: input.jobId,
      errorCode: null,
      errorMessage: null,
      nextRetryAt: null,
      updatedAt: new Date(),
    })
    .where(eq(candidateMemoryArchives.id, input.archiveId));

  if (input.candidateMemoryIds.length > 0) {
    await db
      .update(candidateMemories)
      .set({
        archiveId: input.archiveId,
        archiveStatus: "queued",
        archiveErrorCode: null,
        archiveErrorMessage: null,
        archiveNextRetryAt: null,
        updatedAt: new Date(),
      })
      .where(inArray(candidateMemories.id, input.candidateMemoryIds));
  }
}

async function markCandidateMemoryArchiveArchiving(
  db: Db,
  input: {
    archiveId?: string | null;
    candidateMemoryIds: string[];
  },
) {
  const attemptedAt = new Date();
  if (input.archiveId) {
    await db
      .update(candidateMemoryArchives)
      .set({
        status: "archiving",
        attemptCount: sql`${candidateMemoryArchives.attemptCount} + 1`,
        lastAttemptedAt: attemptedAt,
        updatedAt: attemptedAt,
      })
      .where(eq(candidateMemoryArchives.id, input.archiveId));
  }

  if (input.candidateMemoryIds.length > 0) {
    await db
      .update(candidateMemories)
      .set({
        archiveStatus: "archiving",
        archiveAttemptCount: sql`${candidateMemories.archiveAttemptCount} + 1`,
        archiveLastAttemptedAt: attemptedAt,
        updatedAt: attemptedAt,
      })
      .where(inArray(candidateMemories.id, input.candidateMemoryIds));
  }
}

async function findCandidateMemoryArchiveById(db: Db, id: string) {
  const [row] = await db
    .select()
    .from(candidateMemoryArchives)
    .where(eq(candidateMemoryArchives.id, id))
    .limit(1);

  return row ? toCandidateMemoryArchiveJob(row) : null;
}

async function findDueCandidateMemoryArchives(
  db: Db,
  input: { limit: number; now?: Date },
) {
  const now = input.now ?? new Date();
  const rows = await db
    .select()
    .from(candidateMemoryArchives)
    .where(
      and(
        inArray(candidateMemoryArchives.status, ["pending", "failed_retryable", "failed_blocked"]),
        or(isNull(candidateMemoryArchives.nextRetryAt), lte(candidateMemoryArchives.nextRetryAt, now)),
      ),
    )
    .orderBy(asc(candidateMemoryArchives.createdAt))
    .limit(input.limit);

  return rows.map(toCandidateMemoryArchiveJob);
}

export function createCandidateMemoryMethods(db: Db) {
  return {
    createCandidateMemory: (input: CandidateMemoryInput) => createCandidateMemory(db, input),
    createCandidateMemoryArchive: (input: Parameters<typeof createCandidateMemoryArchive>[1]) =>
      createCandidateMemoryArchive(db, input),
    markCandidateMemoryArchiveQueued: (input: Parameters<typeof markCandidateMemoryArchiveQueued>[1]) =>
      markCandidateMemoryArchiveQueued(db, input),
    markCandidateMemoryArchiveArchiving: (input: Parameters<typeof markCandidateMemoryArchiveArchiving>[1]) =>
      markCandidateMemoryArchiveArchiving(db, input),
    markCandidateMemoriesArchived: (input: Parameters<typeof markCandidateMemoriesArchived>[1]) =>
      markCandidateMemoriesArchived(db, input),
    markCandidateMemoriesArchiveFailed: (input: Parameters<typeof markCandidateMemoriesArchiveFailed>[1]) =>
      markCandidateMemoriesArchiveFailed(db, input),
    findCandidateMemoryArchiveById: (id: string) => findCandidateMemoryArchiveById(db, id),
    findDueCandidateMemoryArchives: (input: Parameters<typeof findDueCandidateMemoryArchives>[1]) =>
      findDueCandidateMemoryArchives(db, input),
  };
}

async function updateExistingCandidateMemory(
  db: Db,
  id: string,
  input: {
    statementStorageRef: string;
    statementSha256: string;
    evidenceLength: number;
    confidenceScore: number;
    archiveId?: string | null;
    archiveStatus?: typeof candidateMemories.$inferSelect["archiveStatus"];
    metadata: Record<string, unknown>;
  },
  canonicalMemory: Awaited<ReturnType<typeof upsertCanonicalMemory>>,
) {
  await db
    .update(candidateMemories)
    .set({
      statementStorageRef: input.statementStorageRef,
      statementSha256: input.statementSha256,
      evidenceLength: input.evidenceLength,
      confidenceScore: input.confidenceScore,
      canonicalMemoryId: canonicalMemory.id,
      archiveId: input.archiveId ?? null,
      archiveStatus: input.archiveStatus ?? archiveStatusFromMetadata(input.metadata),
      metadata: buildCandidateConsolidationMetadata({
        metadata: input.metadata,
        canonicalMemory,
      }),
      updatedAt: new Date(),
    })
    .where(eq(candidateMemories.id, id));
}

async function insertCandidateMemory(
  db: Db,
  input: {
    twinId: string;
    sourceArtifactId: string;
    memoryFragmentId: string;
    archiveId?: string | null;
    memoryType: typeof candidateMemories.$inferSelect["memoryType"];
    statementStorageRef: string;
    statementSha256: string;
    evidenceHash: string;
    evidenceLength: number;
    confidenceScore: number;
    archiveStatus?: typeof candidateMemories.$inferSelect["archiveStatus"];
    metadata: Record<string, unknown>;
  },
  canonicalMemory: Awaited<ReturnType<typeof upsertCanonicalMemory>>,
) {
  const [candidate] = await db
    .insert(candidateMemories)
    .values({
      twinId: input.twinId,
      canonicalMemoryId: canonicalMemory.id,
      archiveId: input.archiveId ?? null,
      sourceArtifactId: input.sourceArtifactId,
      memoryFragmentId: input.memoryFragmentId,
      memoryType: input.memoryType,
      statementStorageRef: input.statementStorageRef,
      statementSha256: input.statementSha256,
      evidenceHash: input.evidenceHash,
      evidenceLength: input.evidenceLength,
      confidenceScore: input.confidenceScore,
      archiveStatus: input.archiveStatus ?? archiveStatusFromMetadata(input.metadata),
      metadata: buildCandidateConsolidationMetadata({
        metadata: input.metadata,
        canonicalMemory,
      }),
    })
    .returning({
      id: candidateMemories.id,
    });

  if (!candidate) {
    throw new Error("Failed to create candidate memory");
  }

  return {
    id: candidate.id,
    canonicalMemoryId: canonicalMemory.id,
  };
}

function archiveStatusFromMetadata(
  metadata: Record<string, unknown>,
): typeof candidateMemories.$inferSelect["archiveStatus"] {
  if (metadata["archiveStatus"] === "pending") {
    return "pending";
  }
  if (metadata["archiveStatus"] === "completed") {
    return "archived";
  }
  if (metadata["archiveStatus"] === "failed") {
    return metadata["archiveErrorCode"] === "walrus_insufficient_balance"
      ? "failed_blocked"
      : "failed_retryable";
  }
  if (metadata["archiveStatus"] === "deferred") {
    return "not_required";
  }
  return "not_required";
}

function candidateArchiveFailureFields(metadata: Record<string, unknown>): {
  status: "failed_retryable" | "failed_blocked";
  errorCode: string | null;
  errorMessage: string | null;
  nextRetryAt: Date;
} {
  const errorCode = typeof metadata["archiveErrorCode"] === "string" ? metadata["archiveErrorCode"] : null;
  const errorMessage =
    typeof metadata["archiveErrorMessage"] === "string"
      ? metadata["archiveErrorMessage"]
      : typeof metadata["archiveReason"] === "string"
        ? metadata["archiveReason"]
        : null;
  const retryDelayMs = 60 * 1000;

  return {
    status: errorCode === "walrus_insufficient_balance" ? "failed_blocked" : "failed_retryable",
    errorCode,
    errorMessage,
    nextRetryAt: new Date(Date.now() + retryDelayMs),
  };
}

function toCandidateMemoryArchiveJob(row: typeof candidateMemoryArchives.$inferSelect) {
  return {
    id: row.id,
    twinId: row.twinId,
    sourceArtifactId: row.sourceArtifactId,
    memoryFragmentId: row.memoryFragmentId,
    sourceType: row.sourceType,
    candidateMemoryIds: row.candidateMemoryIds,
    encryptedBytesBase64: row.encryptedBytesBase64,
    contentSha256: row.contentSha256,
    metadata: asRecord(row.metadata),
  };
}
