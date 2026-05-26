import {
  auditEvents,
  candidateMemories,
  sourceArtifacts,
  userFeedbackEvents,
} from "@sivraj/db";
import {
  DEFAULT_MANUAL_MEMORY_SENSITIVITY,
  ENCRYPTED_WALRUS_STORAGE_MODE,
} from "@sivraj/core";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { Context } from "hono";
import { Hono } from "hono";
import type { AppDependencies } from "../app.js";
import { sanitizeSafeMetadata } from "../lib/safe-metadata.js";
import { requireAuth, requireScope, type AuthEnv } from "../middleware/auth.js";

export function createConversationRoutes({
  db,
  privateMemoryStorage,
  artifactProcessingQueue,
}: AppDependencies) {
  const routes = new Hono<AuthEnv>();

  routes.get("/:artifactId/review", requireAuth, async (c) => {
    const gate = await authorizeConversationReview(c, db);
    if ("response" in gate) {
      return gate.response;
    }

    const candidates = await loadConversationCandidates(db, gate.twinId, gate.artifact.id);

    return c.json({
      policy: conversationPolicy(),
      artifact: conversationArtifactSummary(gate.artifact),
      summary: buildConversationSummary(gate.artifact, candidates),
      candidateMemories: candidates.map(toConversationCandidateReviewItem),
    });
  });

  routes.post("/:artifactId/summary", requireAuth, async (c) => {
    const gate = await authorizeConversationReview(c, db);
    if ("response" in gate) {
      return gate.response;
    }

    if (!privateMemoryStorage) {
      return c.json({ error: "encrypted_storage_not_configured" }, 503);
    }

    const candidates = await loadConversationCandidates(db, gate.twinId, gate.artifact.id);
    const summary = buildConversationSummary(gate.artifact, candidates);
    const summaryText = formatConversationSummaryText(summary);
    const stored = await privateMemoryStorage.storePrivateMemory({
      twinId: gate.twinId,
      sourceType: "note",
      title: "Voice conversation review summary",
      content: summaryText,
      metadata: {
        uploadKind: "voice_conversation_summary",
        sourceArtifactId: gate.artifact.id,
        storageMode: ENCRYPTED_WALRUS_STORAGE_MODE,
        sensitivity: DEFAULT_MANUAL_MEMORY_SENSITIVITY,
      },
    }).catch((error: unknown) => {
      console.error("conversation summary encrypted storage failed", error);
      return null;
    });

    if (!stored) {
      return c.json({ error: "encrypted_storage_failed" }, 503);
    }

    await updateArtifactMetadata(db, gate.artifact, {
      conversationReview: {
        ...readRecord(readRecord(gate.artifact.metadata)["conversationReview"]),
        summary: {
          status: "generated",
          summaryStorageRef: stored.rawStorageRef,
          summarySha256: stored.ciphertextSha256,
          generatedAt: new Date().toISOString(),
          candidateMemoryCount: candidates.length,
          countsByType: summary.countsByType,
          subjectCount: summary.subjects.length,
        },
      },
    });

    await db.insert(auditEvents).values({
      twinId: gate.twinId,
      actorType: gate.auth.type,
      actorId: gate.auth.sub,
      eventType: "conversation.summary.generated",
      resourceType: "source_artifact",
      resourceId: gate.artifact.id,
      metadata: {
        summaryStorageRef: stored.rawStorageRef,
        summarySha256: stored.ciphertextSha256,
        candidateMemoryCount: candidates.length,
      },
    });

    return c.json({
      artifactId: gate.artifact.id,
      status: "generated",
      summaryStorageRef: stored.rawStorageRef,
      summarySha256: stored.ciphertextSha256,
      summary,
    }, 201);
  });

  routes.post("/:artifactId/memories/review", requireAuth, async (c) => {
    const gate = await authorizeConversationReview(c, db);
    if ("response" in gate) {
      return gate.response;
    }

    const body = await c.req.json().catch(() => null);
    const actions = readReviewActions(body);
    if (!actions) {
      return c.json({ error: "invalid_conversation_review_actions" }, 400);
    }

    const candidateIds = Array.from(new Set(actions.map((action) => action.candidateId)));
    const candidates = candidateIds.length > 0
      ? await db
          .select()
          .from(candidateMemories)
          .where(and(
            eq(candidateMemories.twinId, gate.twinId),
            eq(candidateMemories.sourceArtifactId, gate.artifact.id),
            inArray(candidateMemories.id, candidateIds),
          ))
      : [];
    const candidatesById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
    const results: Array<Record<string, unknown>> = [];
    let approvedCount = 0;
    let rejectedCount = 0;
    let editedArtifactCount = 0;

    for (const action of actions) {
      const candidate = candidatesById.get(action.candidateId);
      if (!candidate) {
        results.push({
          candidateId: action.candidateId,
          status: "not_found",
        });
        continue;
      }

      let approvedArtifact: Awaited<ReturnType<typeof createApprovedConversationMemoryArtifact>> | null = null;

      if (action.action === "approve" && action.editedStatement) {
        if (!privateMemoryStorage) {
          return c.json({ error: "encrypted_storage_not_configured" }, 503);
        }

        approvedArtifact = await createApprovedConversationMemoryArtifact({
          db,
          privateMemoryStorage,
          artifactProcessingQueue,
          twinId: gate.twinId,
          sourceArtifactId: gate.artifact.id,
          candidate,
          statement: action.editedStatement,
        });

        if (!approvedArtifact) {
          return c.json({ error: "encrypted_storage_failed" }, 503);
        }
      }

      const feedbackType = action.action === "reject" ? "rejected" : "approved";
      const [updated] = await db
        .update(candidateMemories)
        .set({
          status: feedbackType,
          updatedAt: new Date(),
        })
        .where(and(
          eq(candidateMemories.id, candidate.id),
          eq(candidateMemories.twinId, gate.twinId),
        ))
        .returning({ status: candidateMemories.status });

      await db.insert(userFeedbackEvents).values({
        twinId: gate.twinId,
        targetType: "candidate_memory",
        targetId: candidate.id,
        feedbackType,
        actorType: gate.auth.type,
        actorId: gate.auth.sub,
        metadata: {
          surface: "voice_conversation_review",
          sourceArtifactId: gate.artifact.id,
          hasEditedStatement: Boolean(action.editedStatement),
        },
      });

      if (action.action === "approve") {
        approvedCount += 1;
        editedArtifactCount += approvedArtifact ? 1 : 0;
      } else {
        rejectedCount += 1;
      }

      results.push({
        candidateId: candidate.id,
        action: action.action,
        status: updated?.status ?? feedbackType,
        approvedArtifactId: approvedArtifact?.artifactId ?? null,
        processingJobId: approvedArtifact?.processingJobId ?? null,
      });
    }

    await updateArtifactMetadata(db, gate.artifact, {
      conversationReview: {
        ...readRecord(readRecord(gate.artifact.metadata)["conversationReview"]),
        status: "reviewed",
        reviewedAt: new Date().toISOString(),
        approvedCount,
        rejectedCount,
        editedArtifactCount,
      },
    });

    await db.insert(auditEvents).values({
      twinId: gate.twinId,
      actorType: gate.auth.type,
      actorId: gate.auth.sub,
      eventType: "conversation.memories.reviewed",
      resourceType: "source_artifact",
      resourceId: gate.artifact.id,
      metadata: {
        approvedCount,
        rejectedCount,
        editedArtifactCount,
        actionCount: actions.length,
      },
    });

    return c.json({
      artifactId: gate.artifact.id,
      status: "reviewed",
      approvedCount,
      rejectedCount,
      editedArtifactCount,
      results,
    });
  });

  return routes;
}

async function authorizeConversationReview(
  c: Context<AuthEnv>,
  db: AppDependencies["db"],
) {
  const scopeError = requireScope(c, "memory:read");
  if (scopeError) {
    return { response: scopeError };
  }

  const auth = c.get("auth");
  const twinId = c.req.param("twinId");
  const artifactId = c.req.param("artifactId");

  if (!twinId) {
    return { response: c.json({ error: "missing_twin_id" }, 400) };
  }

  const parsedArtifactId = readUuid(artifactId);

  if (!parsedArtifactId) {
    return { response: c.json({ error: "invalid_artifact_id" }, 400) };
  }

  if (auth.type !== "service" && auth.twinId !== twinId) {
    return { response: c.json({ error: "twin_scope_mismatch" }, 403) };
  }

  const [artifact] = await db
    .select()
    .from(sourceArtifacts)
    .where(and(
      eq(sourceArtifacts.id, parsedArtifactId),
      eq(sourceArtifacts.twinId, twinId),
    ))
    .limit(1);

  if (!artifact) {
    return { response: c.json({ error: "conversation_artifact_not_found" }, 404) };
  }

  if (artifact.sourceType !== "voice_conversation") {
    return { response: c.json({ error: "artifact_is_not_voice_conversation" }, 409) };
  }

  return { auth, twinId, artifact };
}

async function loadConversationCandidates(
  db: AppDependencies["db"],
  twinId: string,
  artifactId: string,
) {
  const rows = await db
    .select()
    .from(candidateMemories)
    .where(and(
      eq(candidateMemories.twinId, twinId),
      eq(candidateMemories.sourceArtifactId, artifactId),
    ))
    .orderBy(desc(candidateMemories.createdAt))
    .limit(200);

  return rows.filter((row) => {
    const metadata = readRecord(row.metadata);
    return metadata["voiceDerived"] === true ||
      metadata["conversationSourceType"] === "voice_conversation" ||
      readRecord(metadata["conversationUnderstanding"])["sourceType"] === "voice_conversation";
  });
}

async function createApprovedConversationMemoryArtifact(input: {
  db: AppDependencies["db"];
  privateMemoryStorage: NonNullable<AppDependencies["privateMemoryStorage"]>;
  artifactProcessingQueue: AppDependencies["artifactProcessingQueue"];
  twinId: string;
  sourceArtifactId: string;
  candidate: typeof candidateMemories.$inferSelect;
  statement: string;
}): Promise<{ artifactId: string; processingJobId: string | null } | null> {
  const metadata = readRecord(input.candidate.metadata);
  const stored = await input.privateMemoryStorage.storePrivateMemory({
    twinId: input.twinId,
    sourceType: "note",
    title: "Approved voice conversation memory",
    content: input.statement,
    metadata: {
      uploadKind: "approved_voice_conversation_memory",
      sourceArtifactId: input.sourceArtifactId,
      sourceCandidateMemoryId: input.candidate.id,
      memoryType: input.candidate.memoryType,
      subject: typeof metadata["subject"] === "string" ? metadata["subject"] : null,
      voiceDerived: true,
      reviewApproved: true,
      storageMode: ENCRYPTED_WALRUS_STORAGE_MODE,
      sensitivity: DEFAULT_MANUAL_MEMORY_SENSITIVITY,
    },
  }).catch((error: unknown) => {
    console.error("approved conversation memory encrypted storage failed", error);
    return null;
  });

  if (!stored) {
    return null;
  }

  const [artifact] = await input.db
    .insert(sourceArtifacts)
    .values({
      twinId: input.twinId,
      sourceType: "note",
      rawStorageRef: stored.rawStorageRef,
      ingestionStatus: "queued",
      metadata: {
        uploadKind: "approved_voice_conversation_memory",
        sourceArtifactId: input.sourceArtifactId,
        sourceCandidateMemoryId: input.candidate.id,
        voiceDerived: true,
        reviewApproved: true,
        storageMode: ENCRYPTED_WALRUS_STORAGE_MODE,
        sensitivity: DEFAULT_MANUAL_MEMORY_SENSITIVITY,
        ciphertextSha256: stored.ciphertextSha256,
        seal: stored.seal,
        walrus: stored.walrus,
      },
    })
    .returning({
      id: sourceArtifacts.id,
      ingestionStatus: sourceArtifacts.ingestionStatus,
    });

  const queued = artifact && input.artifactProcessingQueue
    ? await input.artifactProcessingQueue.enqueueArtifactProcessing({
        artifactId: artifact.id,
        twinId: input.twinId,
        sourceType: "note",
      }).catch((error: unknown) => {
        console.error("approved conversation memory queue failed", error);
        return null;
      })
    : null;

  await input.db.insert(auditEvents).values({
    twinId: input.twinId,
    actorType: "system",
    actorId: "sivraj-api",
    eventType: "conversation.approved_memory.stored",
    resourceType: "source_artifact",
    resourceId: artifact?.id ?? input.sourceArtifactId,
    metadata: {
      sourceArtifactId: input.sourceArtifactId,
      sourceCandidateMemoryId: input.candidate.id,
      rawStorageRef: stored.rawStorageRef,
      processingJobId: queued?.jobId ?? null,
    },
  });

  return artifact ? { artifactId: artifact.id, processingJobId: queued?.jobId ?? null } : null;
}

async function updateArtifactMetadata(
  db: AppDependencies["db"],
  artifact: typeof sourceArtifacts.$inferSelect,
  patch: Record<string, unknown>,
): Promise<void> {
  await db
    .update(sourceArtifacts)
    .set({
      metadata: {
        ...readRecord(artifact.metadata),
        ...patch,
      },
      updatedAt: new Date(),
    })
    .where(and(
      eq(sourceArtifacts.id, artifact.id),
      eq(sourceArtifacts.twinId, artifact.twinId),
    ));
}

function buildConversationSummary(
  artifact: typeof sourceArtifacts.$inferSelect,
  candidates: Array<typeof candidateMemories.$inferSelect>,
) {
  const countsByType: Record<string, number> = {};
  const countsByStatus: Record<string, number> = {};
  const subjects: string[] = [];

  for (const candidate of candidates) {
    countsByType[candidate.memoryType] = (countsByType[candidate.memoryType] ?? 0) + 1;
    countsByStatus[candidate.status] = (countsByStatus[candidate.status] ?? 0) + 1;
    const subject = safeSubject(candidate.metadata);

    if (subject && !subjects.includes(subject)) {
      subjects.push(subject);
    }
  }

  return {
    artifactId: artifact.id,
    status: "ready_for_review",
    generatedAt: new Date().toISOString(),
    candidateMemoryCount: candidates.length,
    countsByType,
    countsByStatus,
    subjects: subjects.slice(0, 20),
    reviewPrompt: candidates.length > 0
      ? "Review the extracted memories. Approve accurate items, reject wrong items, or provide an edited statement before storing it as a new encrypted memory."
      : "No voice-derived candidate memories are ready for review yet.",
  };
}

function formatConversationSummaryText(summary: ReturnType<typeof buildConversationSummary>): string {
  return [
    "# Voice Conversation Summary",
    "",
    `Artifact: ${summary.artifactId}`,
    `Candidate memories: ${summary.candidateMemoryCount}`,
    `Generated: ${summary.generatedAt}`,
    "",
    "## Memory Types",
    ...Object.entries(summary.countsByType).map(([type, count]) => `- ${type}: ${count}`),
    "",
    "## Review Subjects",
    ...(summary.subjects.length > 0 ? summary.subjects.map((subject) => `- ${subject}`) : ["- none"]),
    "",
    "## Review Prompt",
    summary.reviewPrompt,
  ].join("\n");
}

function conversationArtifactSummary(artifact: typeof sourceArtifacts.$inferSelect) {
  const metadata = sanitizeSafeMetadata(artifact.metadata);
  return {
    id: artifact.id,
    sourceType: artifact.sourceType,
    ingestionStatus: artifact.ingestionStatus,
    rawStorageRef: artifact.rawStorageRef,
    metadata,
    createdAt: artifact.createdAt.toISOString(),
    updatedAt: artifact.updatedAt.toISOString(),
  };
}

function toConversationCandidateReviewItem(row: typeof candidateMemories.$inferSelect) {
  return {
    id: row.id,
    memoryType: row.memoryType,
    status: row.status,
    subject: safeSubject(row.metadata),
    statementStorageRef: row.statementStorageRef,
    statementSha256: row.statementSha256,
    evidenceHash: row.evidenceHash,
    evidenceLength: row.evidenceLength,
    confidenceScore: row.confidenceScore,
    metadata: sanitizeSafeMetadata(row.metadata),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function readReviewActions(value: unknown): Array<{
  candidateId: string;
  action: "approve" | "reject";
  editedStatement?: string;
}> | null {
  const record = readRecord(value);
  const actions = Array.isArray(record["actions"]) ? record["actions"] : null;

  if (!actions || actions.length === 0) {
    return null;
  }

  const parsed = actions.map((item) => {
    const action = readRecord(item);
    const candidateId = readUuid(action["candidateId"]);
    const kind = action["action"];
    const editedStatement = typeof action["editedStatement"] === "string" && action["editedStatement"].trim().length > 0
      ? action["editedStatement"].trim()
      : undefined;

    if (!candidateId || (kind !== "approve" && kind !== "reject")) {
      return null;
    }

    return {
      candidateId,
      action: kind,
      editedStatement,
    };
  });

  return parsed.every(Boolean)
    ? parsed as Array<{ candidateId: string; action: "approve" | "reject"; editedStatement?: string }>
    : null;
}

function conversationPolicy() {
  return {
    rawArtifactsIncluded: false,
    decryptedMemoryIncluded: false,
    plaintextStatementsIncluded: false,
    scope: "memory:read",
    approvalRequiredBeforeTwinUpdate: true,
  };
}

function safeSubject(metadata: unknown): string | null {
  const subject = sanitizeSafeMetadata(metadata)["subject"];
  return typeof subject === "string" && subject.length > 0 ? subject : null;
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readUuid(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trimmed)
    ? trimmed
    : null;
}
