import { and, eq, inArray } from "drizzle-orm";
import { candidateMemories, type Db } from "@sivraj/db";
import { upsertCanonicalMemory } from "./canonical-memory-repository.js";
import { buildCandidateConsolidationMetadata } from "./candidate-memory-metadata.js";
import { asRecord } from "./helpers.js";

type CandidateMemoryInput = {
  twinId: string;
  sourceArtifactId: string;
  memoryFragmentId: string;
  memoryType: typeof candidateMemories.$inferSelect["memoryType"];
  statement?: string;
  normalizedStatement?: string;
  statementStorageRef: string;
  statementSha256: string;
  evidenceHash: string;
  evidenceLength: number;
  confidenceScore: number;
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
    return existing;
  }

  return insertCandidateMemory(db, input, canonicalMemory);
}

async function markCandidateMemoriesArchived(
  db: Db,
  input: {
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
        metadata: {
          ...asRecord(row.metadata),
          ...input.metadata,
        },
        updatedAt: new Date(),
      })
      .where(eq(candidateMemories.id, row.id));
  }
}

export function createCandidateMemoryMethods(db: Db) {
  return {
    createCandidateMemory: (input: CandidateMemoryInput) => createCandidateMemory(db, input),
    markCandidateMemoriesArchived: (input: Parameters<typeof markCandidateMemoriesArchived>[1]) =>
      markCandidateMemoriesArchived(db, input),
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
    memoryType: typeof candidateMemories.$inferSelect["memoryType"];
    statementStorageRef: string;
    statementSha256: string;
    evidenceHash: string;
    evidenceLength: number;
    confidenceScore: number;
    metadata: Record<string, unknown>;
  },
  canonicalMemory: Awaited<ReturnType<typeof upsertCanonicalMemory>>,
) {
  const [candidate] = await db
    .insert(candidateMemories)
    .values({
      twinId: input.twinId,
      canonicalMemoryId: canonicalMemory.id,
      sourceArtifactId: input.sourceArtifactId,
      memoryFragmentId: input.memoryFragmentId,
      memoryType: input.memoryType,
      statementStorageRef: input.statementStorageRef,
      statementSha256: input.statementSha256,
      evidenceHash: input.evidenceHash,
      evidenceLength: input.evidenceLength,
      confidenceScore: input.confidenceScore,
      metadata: buildCandidateConsolidationMetadata({
        metadata: input.metadata,
        canonicalMemory,
      }),
    })
    .returning({ id: candidateMemories.id });

  if (!candidate) {
    throw new Error("Failed to create candidate memory");
  }

  return candidate;
}
