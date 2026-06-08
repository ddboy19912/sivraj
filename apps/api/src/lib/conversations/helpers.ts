import type { AuthClaims } from "@sivraj/auth";
import {
  DEFAULT_MANUAL_MEMORY_SENSITIVITY,
  ENCRYPTED_WALRUS_STORAGE_MODE,
} from "@sivraj/core";
import {
  auditEvents,
  candidateMemories,
  sourceArtifacts,
} from "@sivraj/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { Context } from "hono";
import type { AppDependencies } from "../../app.js";
import { sanitizeSafeMetadata } from "../safe-metadata.js";
import { requireScope, type AuthEnv } from "../../middleware/auth.js";
import {
  applyConversationReviewAction,
  isVoiceConversationCandidate,
} from "./review.js";
import { readRecord } from "../http/route-helpers.js";

export type AuthorizedConversationReview = {
  auth: AuthClaims;
  twinId: string;
  artifact: typeof sourceArtifacts.$inferSelect;
};

export type ConversationReviewGateResult =
  | { response: Response }
  | AuthorizedConversationReview;

export type ConversationReviewAction = {
  candidateId: string;
  action: "approve" | "reject";
  editedStatement?: string;
};

export type ConversationReviewProcessResult = {
  approvedCount: number;
  rejectedCount: number;
  editedArtifactCount: number;
  results: Array<Record<string, unknown>>;
};

export type ConversationReviewActionsError = {
  error: {
    status: 503;
    body: { error: string };
  };
};

export type ConversationReviewActionsResult =
  | ConversationReviewProcessResult
  | ConversationReviewActionsError;

export function isConversationReviewActionsError(
  result: ConversationReviewActionsResult,
): result is ConversationReviewActionsError {
  return "error" in result;
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

function safeSubject(metadata: unknown): string | null {
  const subject = sanitizeSafeMetadata(metadata)["subject"];
  return typeof subject === "string" && subject.length > 0 ? subject : null;
}

export function conversationPolicy() {
  return {
    rawArtifactsIncluded: false,
    decryptedMemoryIncluded: false,
    plaintextStatementsIncluded: false,
    scope: "memory:read",
    approvalRequiredBeforeTwinUpdate: true,
  };
}

export function conversationArtifactSummary(artifact: typeof sourceArtifacts.$inferSelect) {
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

export function toConversationCandidateReviewItem(row: typeof candidateMemories.$inferSelect) {
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

export function readReviewActions(value: unknown): ConversationReviewAction[] | null {
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
    ? parsed as ConversationReviewAction[]
    : null;
}

export function buildConversationSummary(
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

export function formatConversationSummaryText(summary: ReturnType<typeof buildConversationSummary>): string {
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

export async function authorizeConversationReview(
  c: Context<AuthEnv>,
  db: AppDependencies["db"],
): Promise<ConversationReviewGateResult> {
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

export async function loadConversationCandidates(
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

  return rows.filter((row) => isVoiceConversationCandidate(row.metadata));
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

export async function processConversationReviewActions(input: {
  db: AppDependencies["db"];
  privateMemoryStorage: AppDependencies["privateMemoryStorage"];
  artifactProcessingQueue: AppDependencies["artifactProcessingQueue"];
  gate: AuthorizedConversationReview;
  actions: ConversationReviewAction[];
}): Promise<ConversationReviewActionsResult> {
  const candidateIds = Array.from(new Set(input.actions.map((action) => action.candidateId)));
  const candidates = candidateIds.length > 0
    ? await input.db
        .select()
        .from(candidateMemories)
        .where(and(
          eq(candidateMemories.twinId, input.gate.twinId),
          eq(candidateMemories.sourceArtifactId, input.gate.artifact.id),
          inArray(candidateMemories.id, candidateIds),
        ))
    : [];
  const candidatesById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const results: Array<Record<string, unknown>> = [];
  let approvedCount = 0;
  let rejectedCount = 0;
  let editedArtifactCount = 0;

  for (const action of input.actions) {
    const outcome = await applyConversationReviewAction({
      ...input,
      action,
      candidate: candidatesById.get(action.candidateId) ?? null,
    });

    if ("error" in outcome && outcome.error) {
      return { error: outcome.error };
    }

    if ("approved" in outcome && outcome.approved) {
      approvedCount += 1;
      editedArtifactCount += outcome.editedArtifact ? 1 : 0;
    } else if ("rejected" in outcome && outcome.rejected) {
      rejectedCount += 1;
    }

    results.push(outcome.result);
  }

  return {
    approvedCount,
    rejectedCount,
    editedArtifactCount,
    results,
  };
}

export async function storeConversationSummary(
  privateMemoryStorage: NonNullable<AppDependencies["privateMemoryStorage"]>,
  input: {
    twinId: string;
    artifactId: string;
    summaryText: string;
  },
) {
  return privateMemoryStorage.storePrivateMemory({
    twinId: input.twinId,
    sourceType: "note",
    title: "Voice conversation review summary",
    content: input.summaryText,
    metadata: {
      uploadKind: "voice_conversation_summary",
      sourceArtifactId: input.artifactId,
      storageMode: ENCRYPTED_WALRUS_STORAGE_MODE,
      sensitivity: DEFAULT_MANUAL_MEMORY_SENSITIVITY,
    },
  }).catch((error: unknown) => {
    console.error("conversation summary encrypted storage failed", error);
    return null;
  });
}

export async function persistConversationSummaryResult(input: {
  db: AppDependencies["db"];
  gate: AuthorizedConversationReview;
  candidates: Array<typeof candidateMemories.$inferSelect>;
  summary: ReturnType<typeof buildConversationSummary>;
  stored: { rawStorageRef: string; ciphertextSha256: string };
}) {
  await updateArtifactMetadata(input.db, input.gate.artifact, {
    conversationReview: {
      ...readRecord(readRecord(input.gate.artifact.metadata)["conversationReview"]),
      summary: {
        status: "generated",
        summaryStorageRef: input.stored.rawStorageRef,
        summarySha256: input.stored.ciphertextSha256,
        generatedAt: new Date().toISOString(),
        candidateMemoryCount: input.candidates.length,
        countsByType: input.summary.countsByType,
        subjectCount: input.summary.subjects.length,
      },
    },
  });

  await input.db.insert(auditEvents).values({
    twinId: input.gate.twinId,
    actorType: input.gate.auth.type,
    actorId: input.gate.auth.sub,
    eventType: "conversation.summary.generated",
    resourceType: "source_artifact",
    resourceId: input.gate.artifact.id,
    metadata: {
      summaryStorageRef: input.stored.rawStorageRef,
      summarySha256: input.stored.ciphertextSha256,
      candidateMemoryCount: input.candidates.length,
    },
  });
}

export async function finalizeConversationReview(
  db: AppDependencies["db"],
  gate: AuthorizedConversationReview,
  actions: ConversationReviewAction[],
  reviewResult: ConversationReviewProcessResult,
) {
  await updateArtifactMetadata(db, gate.artifact, {
    conversationReview: {
      ...readRecord(readRecord(gate.artifact.metadata)["conversationReview"]),
      status: "reviewed",
      reviewedAt: new Date().toISOString(),
      approvedCount: reviewResult.approvedCount,
      rejectedCount: reviewResult.rejectedCount,
      editedArtifactCount: reviewResult.editedArtifactCount,
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
      approvedCount: reviewResult.approvedCount,
      rejectedCount: reviewResult.rejectedCount,
      editedArtifactCount: reviewResult.editedArtifactCount,
      actionCount: actions.length,
    },
  });
}
