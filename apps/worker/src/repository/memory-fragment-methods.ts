import { and, asc, eq } from "drizzle-orm";
import {
  candidateMemories,
  memoryFragments,
  sourceSpeakerMappings,
  twinIdentityProfiles,
  type Db,
} from "@sivraj/db";
import { asRecord, readHandles } from "./helpers.js";

async function findMemoryFragmentBySourceArtifactId(db: Db, sourceArtifactId: string) {
  const [fragment] = await db
    .select({ id: memoryFragments.id })
    .from(memoryFragments)
    .where(eq(memoryFragments.sourceArtifactId, sourceArtifactId))
    .limit(1);

  return fragment ?? null;
}

async function findMemoryFragmentById(db: Db, id: string) {
  const [fragment] = await db
    .select({
      id: memoryFragments.id,
      twinId: memoryFragments.twinId,
      sourceArtifactId: memoryFragments.sourceArtifactId,
      contentStorageRef: memoryFragments.contentStorageRef,
      contentSha256: memoryFragments.contentSha256,
    })
    .from(memoryFragments)
    .where(eq(memoryFragments.id, id))
    .limit(1);

  return fragment ?? null;
}

async function findTwinIdentityProfile(db: Db, twinId: string) {
  const [profile] = await db
    .select()
    .from(twinIdentityProfiles)
    .where(eq(twinIdentityProfiles.twinId, twinId))
    .limit(1);

  return profile
    ? {
        displayName: profile.displayName,
        aliases: profile.aliases,
        emails: profile.emails,
        phones: profile.phones,
        handles: readHandles(profile.handles),
      }
    : null;
}

async function findSourceSpeakerMappings(
  db: Db,
  twinId: string,
  sourceArtifactId: string,
) {
  const rows = await db
    .select()
    .from(sourceSpeakerMappings)
    .where(
      and(
        eq(sourceSpeakerMappings.twinId, twinId),
        eq(sourceSpeakerMappings.sourceArtifactId, sourceArtifactId),
      ),
    );

  return rows.map((row) => ({
    sourceSpeaker: row.sourceSpeaker,
    sourceSpeakerId: row.sourceSpeakerId,
    role: row.role,
    mappedName: row.mappedName,
  }));
}

async function findRecentPatternSignals(db: Db, twinId: string, limit: number) {
  const rows = await db
    .select({
      id: candidateMemories.id,
      sourceArtifactId: candidateMemories.sourceArtifactId,
      memoryFragmentId: candidateMemories.memoryFragmentId,
      memoryType: candidateMemories.memoryType,
      evidenceHash: candidateMemories.evidenceHash,
      evidenceLength: candidateMemories.evidenceLength,
      confidenceScore: candidateMemories.confidenceScore,
      metadata: candidateMemories.metadata,
      createdAt: candidateMemories.createdAt,
    })
    .from(candidateMemories)
    .where(eq(candidateMemories.twinId, twinId))
    .orderBy(asc(candidateMemories.createdAt))
    .limit(limit);

  return rows
    .map((row) => mapPatternSignalRow(twinId, row))
    .filter((signal): signal is NonNullable<typeof signal> => Boolean(signal));
}

async function createMemoryFragment(
  db: Db,
  input: {
    twinId: string;
    sourceArtifactId: string;
    contentStorageRef: string;
    contentSha256?: string | null;
    metadata?: Record<string, unknown> | null;
    importanceScore: number;
    confidenceScore: number;
  },
) {
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
}

export function createMemoryFragmentMethods(db: Db) {
  return {
    findMemoryFragmentBySourceArtifactId: (sourceArtifactId: string) =>
      findMemoryFragmentBySourceArtifactId(db, sourceArtifactId),
    findMemoryFragmentById: (id: string) => findMemoryFragmentById(db, id),
    findTwinIdentityProfile: (twinId: string) => findTwinIdentityProfile(db, twinId),
    findSourceSpeakerMappings: (twinId: string, sourceArtifactId: string) =>
      findSourceSpeakerMappings(db, twinId, sourceArtifactId),
    findRecentPatternSignals: (twinId: string, limit: number) =>
      findRecentPatternSignals(db, twinId, limit),
    createMemoryFragment: (input: Parameters<typeof createMemoryFragment>[1]) =>
      createMemoryFragment(db, input),
  };
}

function mapPatternSignalRow(
  twinId: string,
  row: {
    id: string;
    sourceArtifactId: string;
    memoryFragmentId: string;
    memoryType: typeof candidateMemories.$inferSelect["memoryType"];
    evidenceHash: string;
    evidenceLength: number | null;
    confidenceScore: number | null;
    metadata: unknown;
    createdAt: Date;
  },
) {
  const metadata = asRecord(row.metadata);
  const subject = typeof metadata.subject === "string" ? metadata.subject : null;
  const sourceType = typeof metadata.sourceType === "string" ? metadata.sourceType : "unknown";

  if (!subject) {
    return null;
  }

  return {
    twinId,
    sourceArtifactId: row.sourceArtifactId,
    memoryFragmentId: row.memoryFragmentId,
    candidateMemoryId: row.id,
    memoryType: row.memoryType,
    subject,
    confidence: row.confidenceScore ?? 0.5,
    evidenceHash: row.evidenceHash,
    evidenceLength: row.evidenceLength ?? 0,
    sourceType,
    createdAt: row.createdAt.toISOString(),
    metadata,
  };
}
