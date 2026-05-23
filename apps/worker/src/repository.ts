import { and, asc, eq, gte, inArray, lt } from "drizzle-orm";
import {
  auditEvents,
  candidateMemories,
  graphEdges,
  graphNodes,
  memoryFragments,
  reflectionRuns,
  sourceArtifacts,
  sourceSpeakerMappings,
  twinIdentityProfiles,
  userFeedbackEvents,
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
type CandidateMemoryRow = typeof candidateMemories.$inferSelect;
type FeedbackEventRow = typeof userFeedbackEvents.$inferSelect;

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
    async findTwinIdentityProfile(twinId) {
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
    },
    async findSourceSpeakerMappings(twinId, sourceArtifactId) {
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
    },
    async findRecentPatternSignals(twinId, limit) {
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
        .map((row) => {
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
            evidenceLength: row.evidenceLength,
            sourceType,
            createdAt: row.createdAt.toISOString(),
            metadata,
          };
        })
        .filter((signal): signal is NonNullable<typeof signal> => Boolean(signal));
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
    async findWeeklyReflectionSignals(input) {
      const artifactRows = await db
        .select({ id: sourceArtifacts.id })
        .from(sourceArtifacts)
        .where(
          and(
            eq(sourceArtifacts.twinId, input.twinId),
            gte(sourceArtifacts.createdAt, input.periodStart),
            lt(sourceArtifacts.createdAt, input.periodEnd),
          ),
        );
      const fragmentRows = await db
        .select({ id: memoryFragments.id })
        .from(memoryFragments)
        .where(
          and(
            eq(memoryFragments.twinId, input.twinId),
            gte(memoryFragments.createdAt, input.periodStart),
            lt(memoryFragments.createdAt, input.periodEnd),
          ),
        );
      const candidateRows = await db
        .select({
          id: candidateMemories.id,
          status: candidateMemories.status,
          memoryType: candidateMemories.memoryType,
          metadata: candidateMemories.metadata,
        })
        .from(candidateMemories)
        .where(
          and(
            eq(candidateMemories.twinId, input.twinId),
            gte(candidateMemories.createdAt, input.periodStart),
            lt(candidateMemories.createdAt, input.periodEnd),
          ),
        );
      const graphRows = await db
        .select({
          id: graphNodes.id,
          nodeType: graphNodes.nodeType,
          name: graphNodes.name,
          properties: graphNodes.properties,
        })
        .from(graphNodes)
        .where(
          and(
            eq(graphNodes.twinId, input.twinId),
            gte(graphNodes.createdAt, input.periodStart),
            lt(graphNodes.createdAt, input.periodEnd),
          ),
        );
      const feedbackRows = await db
        .select({
          id: userFeedbackEvents.id,
          feedbackType: userFeedbackEvents.feedbackType,
        })
        .from(userFeedbackEvents)
        .where(
          and(
            eq(userFeedbackEvents.twinId, input.twinId),
            gte(userFeedbackEvents.createdAt, input.periodStart),
            lt(userFeedbackEvents.createdAt, input.periodEnd),
          ),
        );

      const candidateSubjects = summarizeCandidateSubjects(candidateRows);
      const feedbackBreakdown = summarizeFeedbackTypes(feedbackRows);

      return {
        sourceArtifactCount: artifactRows.length,
        memoryFragmentCount: fragmentRows.length,
        candidateMemoryCount: candidateRows.length,
        approvedCandidateMemoryCount: candidateRows.filter((row) => row.status === "approved").length,
        rejectedCandidateMemoryCount: candidateRows.filter((row) => row.status === "rejected").length,
        graphNodeCount: graphRows.length,
        projectCount: graphRows.filter((row) => row.nodeType === "project").length,
        goalCount: graphRows.filter((row) => row.nodeType === "goal").length,
        decisionCount: graphRows.filter((row) => row.nodeType === "decision").length,
        patternCount: graphRows.filter((row) => asRecord(row.properties).kind === "pattern").length,
        feedbackCount: feedbackRows.length,
        usefulFeedbackCount: feedbackRows.filter((row) => row.feedbackType === "useful" || row.feedbackType === "approved").length,
        negativeFeedbackCount: feedbackRows.filter((row) =>
          row.feedbackType === "wrong" ||
          row.feedbackType === "not_me" ||
          row.feedbackType === "too_generic" ||
          row.feedbackType === "too_sensitive" ||
          row.feedbackType === "rejected",
        ).length,
        candidateSubjects,
        graphSubjects: graphRows
          .map((row) => ({
            name: row.name,
            nodeType: row.nodeType,
          }))
          .slice(0, 30),
        feedbackBreakdown,
        sourceArtifactIds: artifactRows.map((row) => row.id),
        memoryFragmentIds: fragmentRows.map((row) => row.id),
        candidateMemoryIds: candidateRows.map((row) => row.id),
        graphNodeIds: graphRows.map((row) => row.id),
      };
    },
    async createReflectionRun(input) {
      const [run] = await db
        .insert(reflectionRuns)
        .values({
          twinId: input.twinId,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          status: input.status,
          summaryStorageRef: input.summaryStorageRef ?? null,
          summarySha256: input.summarySha256 ?? null,
          metadata: input.metadata,
        })
        .returning({ id: reflectionRuns.id });

      if (!run) {
        throw new Error("Failed to create reflection run");
      }

      return run;
    },
    async updateReflectionRun(input) {
      await db
        .update(reflectionRuns)
        .set({
          status: input.status,
          summaryStorageRef: input.summaryStorageRef ?? null,
          summarySha256: input.summarySha256 ?? null,
          metadata: input.metadata,
          updatedAt: new Date(),
        })
        .where(eq(reflectionRuns.id, input.id));
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

function summarizeCandidateSubjects(
  rows: Array<{
    memoryType: CandidateMemoryRow["memoryType"];
    metadata: unknown;
  }>,
): Array<{
  subject: string;
  memoryType: CandidateMemoryRow["memoryType"];
  count: number;
}> {
  const counts = new Map<string, {
    subject: string;
    memoryType: CandidateMemoryRow["memoryType"];
    count: number;
  }>();

  for (const row of rows) {
    const subject = asRecord(row.metadata).subject;

    if (typeof subject !== "string" || !subject.trim()) {
      continue;
    }

    const key = `${row.memoryType}:${subject.trim().toLowerCase()}`;
    const current = counts.get(key);

    if (current) {
      current.count += 1;
      continue;
    }

    counts.set(key, {
      subject: subject.trim(),
      memoryType: row.memoryType,
      count: 1,
    });
  }

  return Array.from(counts.values())
    .sort((a, b) => b.count - a.count || a.subject.localeCompare(b.subject))
    .slice(0, 30);
}

function summarizeFeedbackTypes(
  rows: Array<{ feedbackType: FeedbackEventRow["feedbackType"] }>,
): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const row of rows) {
    counts[row.feedbackType] = (counts[row.feedbackType] ?? 0) + 1;
  }

  return counts;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}

function readHandles(value: unknown): Record<string, string[]> {
  const record = asRecord(value);
  const handles: Record<string, string[]> = {};

  for (const [key, item] of Object.entries(record)) {
    handles[key] = readStringArray(item);
  }

  return handles;
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
