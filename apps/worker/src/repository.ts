import { and, asc, eq, inArray, lt } from "drizzle-orm";
import {
  auditEvents,
  candidateMemories,
  graphEdges,
  graphNodes,
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
    async findArtifactById(id) {
      const [row] = await db
        .select()
        .from(sourceArtifacts)
        .where(eq(sourceArtifacts.id, id))
        .limit(1);

      return row ? toQueuedArtifact(row) : null;
    },
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
    async findMemoryFragmentById(id) {
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
    async upsertGraphNode(input) {
      const normalizedName = input.normalizedName ?? normalizeGraphNodeName(input.name);
      const [existing] = await db
        .select({
          id: graphNodes.id,
          name: graphNodes.name,
          properties: graphNodes.properties,
          confidenceScore: graphNodes.confidenceScore,
        })
        .from(graphNodes)
        .where(
          and(
            eq(graphNodes.twinId, input.twinId),
            eq(graphNodes.nodeType, input.nodeType),
            eq(graphNodes.normalizedName, normalizedName),
          ),
        )
        .limit(1);

      if (existing) {
        const mergedProperties = mergeGraphNodeProperties(
          existing.properties,
          input.properties,
        );
        const confidenceScore = maxNullableNumber(
          existing.confidenceScore,
          input.confidenceScore,
        );

        await db
          .update(graphNodes)
          .set({
            properties: mergedProperties,
            confidenceScore,
            updatedAt: new Date(),
          })
          .where(eq(graphNodes.id, existing.id));

        return existing;
      }

      const [node] = await db
        .insert(graphNodes)
        .values({
          twinId: input.twinId,
          nodeType: input.nodeType,
          name: input.name,
          normalizedName,
          description: input.description ?? null,
          properties: mergeGraphNodeProperties(null, input.properties),
          confidenceScore: input.confidenceScore,
        })
        .returning({ id: graphNodes.id });

      if (!node) {
        throw new Error("Failed to create graph node");
      }

      return node;
    },
    async upsertGraphEdge(input) {
      const [existing] = await db
        .select({
          id: graphEdges.id,
          evidenceMemoryIds: graphEdges.evidenceMemoryIds,
        })
        .from(graphEdges)
        .where(
          and(
            eq(graphEdges.twinId, input.twinId),
            eq(graphEdges.fromNodeId, input.fromNodeId),
            eq(graphEdges.toNodeId, input.toNodeId),
            eq(graphEdges.edgeType, input.edgeType),
          ),
        )
        .limit(1);

      if (existing) {
        await db
          .update(graphEdges)
          .set({
            evidenceMemoryIds: Array.from(new Set([
              ...existing.evidenceMemoryIds,
              ...input.evidenceMemoryIds,
            ])),
            confidenceScore: input.confidenceScore,
            updatedAt: new Date(),
          })
          .where(eq(graphEdges.id, existing.id));

        return { id: existing.id };
      }

      const [edge] = await db
        .insert(graphEdges)
        .values({
          twinId: input.twinId,
          fromNodeId: input.fromNodeId,
          toNodeId: input.toNodeId,
          edgeType: input.edgeType,
          description: input.description ?? null,
          evidenceMemoryIds: input.evidenceMemoryIds,
          confidenceScore: input.confidenceScore,
        })
        .returning({ id: graphEdges.id });

      if (!edge) {
        throw new Error("Failed to create graph edge");
      }

      return edge;
    },
    async createCandidateMemory(input) {
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
        await db
          .update(candidateMemories)
          .set({
            statementStorageRef: input.statementStorageRef,
            statementSha256: input.statementSha256,
            evidenceLength: input.evidenceLength,
            confidenceScore: input.confidenceScore,
            metadata: input.metadata,
            updatedAt: new Date(),
          })
          .where(eq(candidateMemories.id, existing.id));

        return existing;
      }

      const [candidate] = await db
        .insert(candidateMemories)
        .values({
          twinId: input.twinId,
          sourceArtifactId: input.sourceArtifactId,
          memoryFragmentId: input.memoryFragmentId,
          memoryType: input.memoryType,
          statementStorageRef: input.statementStorageRef,
          statementSha256: input.statementSha256,
          evidenceHash: input.evidenceHash,
          evidenceLength: input.evidenceLength,
          confidenceScore: input.confidenceScore,
          metadata: input.metadata,
        })
        .returning({ id: candidateMemories.id });

      if (!candidate) {
        throw new Error("Failed to create candidate memory");
      }

      return candidate;
    },
    async markCandidateMemoriesArchived(input) {
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

function normalizeGraphNodeName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

function mergeGraphNodeProperties(
  existing: unknown,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const existingRecord = asRecord(existing);
  const now = new Date().toISOString();
  const aliases = mergeStringArrays(
    readStringArray(existingRecord.aliases),
    readStringArray(incoming.aliases),
  );
  const sourceTypes = mergeStringArrays(
    readStringArray(existingRecord.sourceTypes),
    readStringArray(incoming.sourceTypes),
    typeof incoming.sourceType === "string" ? [incoming.sourceType] : [],
  );
  const mentionCount =
    readNumber(existingRecord.mentionCount) +
    Math.max(1, readNumber(incoming.mentionCount));

  return {
    ...existingRecord,
    ...incoming,
    aliases,
    sourceTypes,
    mentionCount,
    firstSeenAt:
      typeof existingRecord.firstSeenAt === "string"
        ? existingRecord.firstSeenAt
        : now,
    lastSeenAt: now,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}

function mergeStringArrays(...arrays: string[][]): string[] {
  return Array.from(new Set(arrays.flat().map((value) => value.trim()).filter(Boolean)));
}

function readNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function maxNullableNumber(
  first: number | null,
  second: number | null | undefined,
): number | null {
  if (first === null || first === undefined) {
    return second ?? null;
  }

  if (second === null || second === undefined) {
    return first;
  }

  return Math.max(first, second);
}
