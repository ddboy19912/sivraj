import { and, asc, eq } from "drizzle-orm";
import {
  candidateMemories,
  documentChunks,
  documentPages,
  documentStructureItems,
  memoryFragments,
  sourceSpeakerMappings,
  twinIdentityProfiles,
  type Db,
} from "@sivraj/db";
import { asRecord, readHandles } from "./helpers.js";

async function findMemoryFragmentBySourceArtifactId(db: Db, sourceArtifactId: string) {
  const [fragment] = await db
    .select({
      id: memoryFragments.id,
      contentStorageRef: memoryFragments.contentStorageRef,
      contentSha256: memoryFragments.contentSha256,
      metadata: memoryFragments.metadata,
    })
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
    storageStatus?: typeof memoryFragments.$inferInsert["storageStatus"];
    storageProvider?: string;
    walrusNetwork?: string | null;
    storageVerifiedAt?: Date | null;
    importanceScore: number;
    confidenceScore: number;
  },
) {
  const storage = readMemoryStorageMetadata(input.metadata);
  const [fragment] = await db
    .insert(memoryFragments)
    .values({
      twinId: input.twinId,
      sourceArtifactId: input.sourceArtifactId,
      contentStorageRef: input.contentStorageRef,
      contentSha256: input.contentSha256 ?? null,
      storageStatus: input.storageStatus ?? "verified_available",
      storageProvider: input.storageProvider ?? "walrus",
      walrusNetwork: input.walrusNetwork ?? storage.walrusNetwork,
      walrusBlobId: storage.blobId,
      walrusBlobObjectId: storage.blobObjectId,
      walrusStartEpoch: storage.startEpoch,
      walrusEndEpoch: storage.endEpoch,
      storageVerifiedAt: input.storageVerifiedAt ?? new Date(),
      storageRenewalDueEpoch: storage.endEpoch !== null ? Math.max(storage.endEpoch - 1, 0) : null,
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

async function replaceDocumentChunks(
  db: Db,
  input: {
    twinId: string;
    sourceArtifactId: string;
    memoryFragmentId: string;
    chunks: Array<{
      chunkIndex: number;
      contentStorageRef: string;
      contentSha256: string;
      tokenCount: number;
      charStart: number;
      charEnd: number;
      pageStart?: number | null;
      pageEnd?: number | null;
      embedding?: number[] | null;
      embeddingModel?: string | null;
      embeddingProvider?: string | null;
      embeddingGeneratedAt?: Date | null;
      metadata?: Record<string, unknown> | null;
    }>;
  },
) {
  await db
    .delete(documentChunks)
    .where(and(
      eq(documentChunks.twinId, input.twinId),
      eq(documentChunks.sourceArtifactId, input.sourceArtifactId),
    ));

  if (input.chunks.length === 0) {
    return { count: 0 };
  }

  await db.insert(documentChunks).values(
    input.chunks.map((chunk) => {
      const storage = readMemoryStorageMetadata(chunk.metadata);

      return {
        twinId: input.twinId,
        sourceArtifactId: input.sourceArtifactId,
        memoryFragmentId: input.memoryFragmentId,
        chunkIndex: chunk.chunkIndex,
        contentStorageRef: chunk.contentStorageRef,
        contentSha256: chunk.contentSha256,
        tokenCount: chunk.tokenCount,
        charStart: chunk.charStart,
        charEnd: chunk.charEnd,
        pageStart: chunk.pageStart ?? null,
        pageEnd: chunk.pageEnd ?? null,
        embedding: chunk.embedding ?? null,
        embeddingModel: chunk.embeddingModel ?? null,
        embeddingProvider: chunk.embeddingProvider ?? null,
        embeddingGeneratedAt: chunk.embeddingGeneratedAt ?? null,
        storageStatus: "verified_available" as const,
        storageProvider: "walrus",
        walrusNetwork: storage.walrusNetwork,
        walrusBlobId: storage.blobId,
        walrusBlobObjectId: storage.blobObjectId,
        walrusStartEpoch: storage.startEpoch,
        walrusEndEpoch: storage.endEpoch,
        storageVerifiedAt: new Date(),
        metadata: chunk.metadata ?? null,
      };
    }),
  );

  return { count: input.chunks.length };
}

async function replaceDocumentPages(
  db: Db,
  input: {
    twinId: string;
    sourceArtifactId: string;
    memoryFragmentId: string;
    pages: Array<{
      pageNumber: number;
      contentStorageRef: string;
      contentSha256: string;
      tokenCount: number;
      charStart: number;
      charEnd: number;
      metadata?: Record<string, unknown> | null;
    }>;
  },
) {
  await db
    .delete(documentPages)
    .where(and(
      eq(documentPages.twinId, input.twinId),
      eq(documentPages.sourceArtifactId, input.sourceArtifactId),
    ));

  if (input.pages.length === 0) {
    return { count: 0 };
  }

  await db.insert(documentPages).values(
    input.pages.map((page) => {
      const storage = readMemoryStorageMetadata(page.metadata);

      return {
        twinId: input.twinId,
        sourceArtifactId: input.sourceArtifactId,
        memoryFragmentId: input.memoryFragmentId,
        pageNumber: page.pageNumber,
        contentStorageRef: page.contentStorageRef,
        contentSha256: page.contentSha256,
        tokenCount: page.tokenCount,
        charStart: page.charStart,
        charEnd: page.charEnd,
        storageStatus: "verified_available" as const,
        storageProvider: "walrus",
        walrusNetwork: storage.walrusNetwork,
        walrusBlobId: storage.blobId,
        walrusBlobObjectId: storage.blobObjectId,
        walrusStartEpoch: storage.startEpoch,
        walrusEndEpoch: storage.endEpoch,
        storageVerifiedAt: new Date(),
        metadata: page.metadata ?? null,
      };
    }),
  );

  return { count: input.pages.length };
}

async function replaceDocumentStructureItems(
  db: Db,
  input: {
    twinId: string;
    sourceArtifactId: string;
    memoryFragmentId: string;
    items: Array<{
      itemType: string;
      label: string;
      normalizedLabel: string;
      ordinal?: number | null;
      pageStart?: number | null;
      pageEnd?: number | null;
      charStart?: number | null;
      charEnd?: number | null;
      confidenceScore?: number | null;
      extractionMethod: string;
      metadata?: Record<string, unknown> | null;
    }>;
  },
) {
  await db
    .delete(documentStructureItems)
    .where(and(
      eq(documentStructureItems.twinId, input.twinId),
      eq(documentStructureItems.sourceArtifactId, input.sourceArtifactId),
    ));

  if (input.items.length === 0) {
    return { count: 0 };
  }

  await db.insert(documentStructureItems).values(
    input.items.map((item) => ({
      twinId: input.twinId,
      sourceArtifactId: input.sourceArtifactId,
      memoryFragmentId: input.memoryFragmentId,
      itemType: item.itemType,
      label: item.label,
      normalizedLabel: item.normalizedLabel,
      ordinal: item.ordinal ?? null,
      pageStart: item.pageStart ?? null,
      pageEnd: item.pageEnd ?? null,
      charStart: item.charStart ?? null,
      charEnd: item.charEnd ?? null,
      confidenceScore: item.confidenceScore ?? null,
      extractionMethod: item.extractionMethod,
      metadata: item.metadata ?? null,
    })),
  );

  return { count: input.items.length };
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
    replaceDocumentChunks: (input: Parameters<typeof replaceDocumentChunks>[1]) =>
      replaceDocumentChunks(db, input),
    replaceDocumentPages: (input: Parameters<typeof replaceDocumentPages>[1]) =>
      replaceDocumentPages(db, input),
    replaceDocumentStructureItems: (input: Parameters<typeof replaceDocumentStructureItems>[1]) =>
      replaceDocumentStructureItems(db, input),
  };
}

function readMemoryStorageMetadata(metadata: Record<string, unknown> | null | undefined) {
  const walrus = metadata?.walrus;
  const walrusRecord = walrus && typeof walrus === "object"
    ? walrus as Record<string, unknown>
    : {};

  return {
    walrusNetwork: readString(metadata?.walrusNetwork) ?? readString(walrusRecord.network),
    blobId: readString(walrusRecord.blobId),
    blobObjectId: readString(walrusRecord.blobObjectId),
    startEpoch: readNumber(walrusRecord.startEpoch),
    endEpoch: readNumber(walrusRecord.endEpoch),
  };
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
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
