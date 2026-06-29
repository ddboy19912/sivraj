import { and, desc, eq, sql } from "drizzle-orm";
import { canonicalMemories, type Db } from "@sivraj/db";
import type { ArtifactRepository } from "../types/ingestion.types.js";
import {
  buildCanonicalMemoryKey,
  maxNullableNumber,
  mergeCanonicalMemoryMetadata,
  rankCanonicalMergeCandidates,
} from "./canonical-memory.js";
import {
  readCanonicalSubject,
  shouldApplySemanticCanonicalMerge,
} from "./canonical-memory-upsert.js";
import { asRecord } from "./helpers.js";

type CandidateMemoryInput = Parameters<ArtifactRepository["createCandidateMemory"]>[0];

export type CanonicalMemoryUpsertResult = {
  id: string;
  canonicalKey: string;
  existing: boolean;
  semanticMerge?: {
    decision: "same" | "related" | "conflicting" | "separate";
    confidence: number;
    reason: string;
    canonicalMemoryId: string | null;
  };
};

type SemanticMergeDecision = NonNullable<CanonicalMemoryUpsertResult["semanticMerge"]>;

async function findCanonicalByKey(
  db: Db,
  twinId: string,
  canonicalKey: string,
) {
  const [existing] = await db
    .select({
      id: canonicalMemories.id,
      evidenceCount: canonicalMemories.evidenceCount,
      confidenceScore: canonicalMemories.confidenceScore,
      metadata: canonicalMemories.metadata,
    })
    .from(canonicalMemories)
    .where(
      and(
        eq(canonicalMemories.twinId, twinId),
        eq(canonicalMemories.canonicalKey, canonicalKey),
      ),
    )
    .limit(1);

  return existing ?? null;
}

async function updateCanonicalMemoryEvidence(
  db: Db,
  existing: {
    id: string;
    confidenceScore: number | null;
    metadata: unknown;
  },
  input: CandidateMemoryInput,
  now: Date,
  semanticMerge?: SemanticMergeDecision,
) {
  await db
    .update(canonicalMemories)
    .set({
      evidenceCount: sql`${canonicalMemories.evidenceCount} + 1`,
      confidenceScore: maxNullableNumber(existing.confidenceScore, input.confidenceScore),
      metadata: mergeCanonicalMemoryMetadata(existing.metadata, input.metadata, {
        sourceArtifactId: input.sourceArtifactId,
        memoryFragmentId: input.memoryFragmentId,
        evidenceHash: input.evidenceHash,
        semanticMerge,
      }),
      lastSeenAt: now,
      updatedAt: now,
    })
    .where(and(
      eq(canonicalMemories.id, existing.id),
      eq(canonicalMemories.twinId, input.twinId),
    ));
}

async function applySemanticCanonicalMerge(
  db: Db,
  input: CandidateMemoryInput,
  semanticMerge: SemanticMergeDecision,
  now: Date,
): Promise<CanonicalMemoryUpsertResult | null> {
  const canonicalMemoryId = semanticMerge.canonicalMemoryId;

  if (!canonicalMemoryId) {
    return null;
  }

  const [semanticExisting] = await db
    .select({
      id: canonicalMemories.id,
      canonicalKey: canonicalMemories.canonicalKey,
      evidenceCount: canonicalMemories.evidenceCount,
      confidenceScore: canonicalMemories.confidenceScore,
      metadata: canonicalMemories.metadata,
    })
    .from(canonicalMemories)
    .where(
      and(
        eq(canonicalMemories.twinId, input.twinId),
        eq(canonicalMemories.id, canonicalMemoryId),
      ),
    )
    .limit(1);

  if (!semanticExisting) {
    return null;
  }

  await updateCanonicalMemoryEvidence(db, semanticExisting, input, now, semanticMerge);

  return {
    id: semanticExisting.id,
    canonicalKey: semanticExisting.canonicalKey,
    existing: true,
    semanticMerge,
  };
}

async function insertCanonicalMemory(
  db: Db,
  input: CandidateMemoryInput,
  canonicalKey: string,
  subject: string | null,
  now: Date,
  semanticMerge: SemanticMergeDecision | null,
): Promise<CanonicalMemoryUpsertResult> {
  const [created] = await db
    .insert(canonicalMemories)
    .values({
      twinId: input.twinId,
      memoryType: input.memoryType,
      canonicalKey,
      subject,
      status: "candidate",
      evidenceCount: 1,
      confidenceScore: input.confidenceScore,
      metadata: mergeCanonicalMemoryMetadata(null, input.metadata, {
        sourceArtifactId: input.sourceArtifactId,
        memoryFragmentId: input.memoryFragmentId,
        evidenceHash: input.evidenceHash,
        semanticMerge: semanticMerge ?? undefined,
      }),
      firstSeenAt: now,
      lastSeenAt: now,
    })
    .returning({ id: canonicalMemories.id });

  if (!created) {
    throw new Error("Failed to create canonical memory");
  }

  return {
    id: created.id,
    canonicalKey,
    existing: false,
    semanticMerge: semanticMerge ?? undefined,
  };
}

export async function upsertCanonicalMemory(
  db: Db,
  input: CandidateMemoryInput,
): Promise<CanonicalMemoryUpsertResult> {
  const metadata = asRecord(input.metadata);
  const subject = readCanonicalSubject(metadata);
  const canonicalKey = buildCanonicalMemoryKey(input.memoryType, metadata, subject);
  const now = new Date();
  const existing = await findCanonicalByKey(db, input.twinId, canonicalKey);

  if (existing) {
    await updateCanonicalMemoryEvidence(db, existing, input, now);

    return {
      id: existing.id,
      canonicalKey,
      existing: true,
    };
  }

  const semanticMerge = await judgeSemanticCanonicalMerge(db, input, subject);

  if (semanticMerge && shouldApplySemanticCanonicalMerge(semanticMerge)) {
    const semanticResult = await applySemanticCanonicalMerge(db, input, semanticMerge, now);

    if (semanticResult) {
      return semanticResult;
    }
  }

  return insertCanonicalMemory(db, input, canonicalKey, subject, now, semanticMerge);
}

async function fetchCanonicalMergeCandidates(
  db: Db,
  twinId: string,
  memoryType: CandidateMemoryInput["memoryType"],
  subject: string | null,
) {
  const rows = await db
    .select({
      id: canonicalMemories.id,
      memoryType: canonicalMemories.memoryType,
      canonicalKey: canonicalMemories.canonicalKey,
      subject: canonicalMemories.subject,
      confidenceScore: canonicalMemories.confidenceScore,
      metadata: canonicalMemories.metadata,
      updatedAt: canonicalMemories.updatedAt,
    })
    .from(canonicalMemories)
    .where(
      and(
        eq(canonicalMemories.twinId, twinId),
        eq(canonicalMemories.memoryType, memoryType),
      ),
    )
    .orderBy(desc(canonicalMemories.updatedAt))
    .limit(24);

  return rankCanonicalMergeCandidates(rows, subject).slice(0, 12);
}

async function invokeMergeJudge(
  input: CandidateMemoryInput,
  existing: Awaited<ReturnType<typeof fetchCanonicalMergeCandidates>>,
  subject: string | null,
): Promise<SemanticMergeDecision | null> {
  const metadata = asRecord(input.metadata);
  const normalizedStatementHash = typeof metadata.normalizedStatementHash === "string"
    ? metadata.normalizedStatementHash
    : "";

  return input.mergeJudge!.judge({
    candidate: {
      memoryType: input.memoryType,
      statement: input.statement!,
      normalizedStatement: input.normalizedStatement ?? null,
      subject,
      normalizedStatementHash,
      metadata: input.metadata,
    },
    existing: existing.map((row) => ({
      id: row.id,
      memoryType: row.memoryType,
      canonicalKey: row.canonicalKey,
      subject: row.subject,
      confidenceScore: row.confidenceScore,
      metadata: row.metadata && typeof row.metadata === "object"
        ? row.metadata as Record<string, unknown>
        : {},
    })),
  });
}

async function judgeSemanticCanonicalMerge(
  db: Db,
  input: CandidateMemoryInput,
  subject: string | null,
): Promise<SemanticMergeDecision | null> {
  if (!input.mergeJudge || !input.statement?.trim()) {
    return null;
  }

  const existing = await fetchCanonicalMergeCandidates(
    db,
    input.twinId,
    input.memoryType,
    subject,
  );

  if (existing.length === 0) {
    return null;
  }

  try {
    return await invokeMergeJudge(input, existing, subject);
  } catch (error) {
    console.warn("canonical memory semantic merge judge failed", {
      twinId: input.twinId,
      sourceArtifactId: input.sourceArtifactId,
      memoryType: input.memoryType,
      errorName: error instanceof Error ? error.name : "UnknownError",
      errorMessage: error instanceof Error ? error.message : String(error),
    });

    return null;
  }
}
